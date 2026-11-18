const ORIGEN = 'https://jesusefx.es';
const MAX_NOMBRE = 100;
const MAX_EMAIL = 200;
const MAX_MENSAJE = 2000;
const MAX_CUERPO = 8192;
const MAX_LISTA = 200;
const TTL_MENSAJE = 31536000;
const MAX_POR_DIA = 3;
const MAX_POR_MINUTO = 1;
const TTL_DIA = 86400;
const TTL_MINUTO = 60;
const TTL_DUPLICADO = 3600;
const MAX_ENLACES = 2;
const SEGUNDOS_MINIMOS = 3;
const EQUIPO_ACCESS = 'holy-field-ca19.cloudflareaccess.com';
const PALABRAS_BLOQUEADAS = [
  'casino', 'crypto', 'bitcoin', 'viagra', 'prestamo', 'préstamo',
  'backlink', 'escort', 'porn', 'xxx', 'lottery', 'lotería', 'apuestas',
];

const CORS = {
  'Access-Control-Allow-Origin': ORIGEN,
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Vary': 'Origin',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === '/contact') {
      return procesarContacto(request, env);
    }

    if (url.pathname === '/mensajes' || url.pathname.startsWith('/mensajes/')) {
      const autorizado = await verificarAccess(request, env);
      if (!autorizado) {
        return new Response('No autorizado', { status: 403 });
      }
    }

    if (url.pathname === '/mensajes') {
      return listarMensajes(env);
    }

    if (url.pathname === '/mensajes/borrar' && request.method === 'POST') {
      return borrarMensaje(request, env);
    }

    if (url.pathname === '/mensajes/borrar-todos' && request.method === 'POST') {
      return borrarTodos(request, env);
    }

    return respuestaJson({ error: 'no_encontrado' }, 404);
  },
};

async function procesarContacto(request, env) {
  if (request.method !== 'POST') {
    return respuestaJson({ error: 'metodo' }, 405, CORS);
  }

  const tamano = Number(request.headers.get('content-length') || 0);
  if (tamano > MAX_CUERPO) {
    return respuestaJson({ error: 'grande' }, 413, CORS);
  }

  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return respuestaJson({ error: 'json' }, 400, CORS);
  }

  const datos = {
    nombre: String(cuerpo.nombre || '').trim().slice(0, MAX_NOMBRE),
    email: String(cuerpo.email || '').trim().slice(0, MAX_EMAIL),
    mensaje: String(cuerpo.mensaje || '').trim().slice(0, MAX_MENSAJE),
    token: String(cuerpo['cf-turnstile-response'] || ''),
    acepta: cuerpo.acepta === true,
    empresa: String(cuerpo.empresa || '').trim(),
    inicio: Number(cuerpo.inicio || 0),
  };

  const ip = request.headers.get('CF-Connecting-IP') || 'sin-ip';

  if (datos.empresa) {
    return respuestaJson({ error: 'spam' }, 400, CORS);
  }

  if (!datos.inicio || Date.now() - datos.inicio < SEGUNDOS_MINIMOS * 1000) {
    return respuestaJson({ error: 'rapido' }, 400, CORS);
  }

  const error = validar(datos);
  if (error) {
    return respuestaJson({ error }, 400, CORS);
  }

  const spam = detectarSpam(datos.mensaje);
  if (spam) {
    return respuestaJson({ error: spam }, 400, CORS);
  }

  const frecuencia = await comprobarFrecuencia(env.MENSAJES, ip);
  if (frecuencia) {
    return respuestaJson({ error: frecuencia }, 429, CORS);
  }

  const captchaCorrecto = await verificarCaptcha(
    env.TURNSTILE_SECRET,
    datos.token,
    request.headers.get('CF-Connecting-IP')
  );
  if (!captchaCorrecto) {
    return respuestaJson({ error: 'captcha' }, 403, CORS);
  }

  const repetido = await esDuplicado(env.MENSAJES, ip, datos.mensaje);
  if (repetido) {
    return respuestaJson({ error: 'duplicado' }, 409, CORS);
  }

  await guardarMensaje(env.MENSAJES, datos, request.cf?.country || '');
  await Promise.all([
    anotarEnvio(env.MENSAJES, ip),
    marcarDuplicado(env.MENSAJES, ip, datos.mensaje),
  ]);

  return respuestaJson({ ok: true }, 200, CORS);
}

function validar(datos) {
  if (!datos.nombre || !datos.mensaje) {
    return 'campos';
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(datos.email)) {
    return 'email';
  }
  if (!datos.token) {
    return 'captcha';
  }
  if (!datos.acepta) {
    return 'consentimiento';
  }
  return '';
}

let cacheCertificados = null;

function base64urlBytes(texto) {
  const normal = texto.replace(/-/g, '+').replace(/_/g, '/');
  const relleno = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  const binario = atob(relleno);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}

async function clavesAccess(equipo) {
  const ahora = Date.now();
  if (cacheCertificados && cacheCertificados.expira > ahora) {
    return cacheCertificados.claves;
  }

  const respuesta = await fetch(`https://${equipo}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!respuesta.ok) {
    throw new Error('no se pudieron leer los certificados de Access');
  }

  const datos = await respuesta.json();
  const claves = new Map();
  for (const jwk of datos.keys || []) {
    if (jwk.kty !== 'RSA') continue;
    const clave = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    claves.set(jwk.kid, clave);
  }

  cacheCertificados = { claves, expira: ahora + 300000 };
  return claves;
}

async function verificarAccess(request, env) {
  if (!env.ACCESS_AUD) {
    return true;
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    return false;
  }

  const partes = token.split('.');
  if (partes.length !== 3) {
    return false;
  }

  const [cabecera64, carga64, firma64] = partes;

  try {
    const cabecera = JSON.parse(new TextDecoder().decode(base64urlBytes(cabecera64)));
    if (cabecera.alg !== 'RS256') {
      return false;
    }

    const equipo = env.ACCESS_TEAM || EQUIPO_ACCESS;
    const clave = (await clavesAccess(equipo)).get(cabecera.kid);
    if (!clave) {
      return false;
    }

    const firmado = new TextEncoder().encode(`${cabecera64}.${carga64}`);
    const valida = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', clave, base64urlBytes(firma64), firmado
    );
    if (!valida) {
      return false;
    }

    const carga = JSON.parse(new TextDecoder().decode(base64urlBytes(carga64)));
    const destinatarios = Array.isArray(carga.aud) ? carga.aud : [carga.aud];
    if (!destinatarios.includes(env.ACCESS_AUD)) {
      return false;
    }
    if (typeof carga.exp !== 'number' || carga.exp * 1000 <= Date.now()) {
      return false;
    }
    if (carga.nbf && carga.nbf * 1000 > Date.now() + 30000) {
      return false;
    }
    if (carga.iss !== `https://${equipo}`) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function detectarSpam(mensaje) {
  const enlaces = (mensaje.match(/https?:\/\//gi) || []).length;
  if (enlaces > MAX_ENLACES) {
    return 'enlaces';
  }

  const texto = mensaje.toLowerCase();
  if (PALABRAS_BLOQUEADAS.some((palabra) => texto.includes(palabra))) {
    return 'spam';
  }

  return '';
}

async function clavesDeFrecuencia(ip) {
  const ahora = new Date().toISOString();
  const identificador = await huella(ip, 'limite');
  return {
    minuto: `rl:${identificador}:m:${ahora.slice(0, 16)}`,
    dia: `rl:${identificador}:d:${ahora.slice(0, 10)}`,
  };
}

async function comprobarFrecuencia(almacen, ip) {
  const claves = await clavesDeFrecuencia(ip);
  const [porMinuto, porDia] = await Promise.all([
    almacen.get(claves.minuto),
    almacen.get(claves.dia),
  ]);

  if (Number(porMinuto || 0) >= MAX_POR_MINUTO) {
    return 'frecuencia';
  }
  if (Number(porDia || 0) >= MAX_POR_DIA) {
    return 'frecuencia';
  }

  return '';
}

async function anotarEnvio(almacen, ip) {
  const claves = await clavesDeFrecuencia(ip);
  const [porMinuto, porDia] = await Promise.all([
    almacen.get(claves.minuto),
    almacen.get(claves.dia),
  ]);

  await Promise.all([
    almacen.put(claves.minuto, String(Number(porMinuto || 0) + 1), { expirationTtl: TTL_MINUTO }),
    almacen.put(claves.dia, String(Number(porDia || 0) + 1), { expirationTtl: TTL_DIA }),
  ]);
}

async function huella(ip, mensaje) {
  const datos = new TextEncoder().encode(`${ip}|${mensaje.toLowerCase()}`);
  const resumen = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function esDuplicado(almacen, ip, mensaje) {
  return Boolean(await almacen.get(`dup:${await huella(ip, mensaje)}`));
}

async function marcarDuplicado(almacen, ip, mensaje) {
  await almacen.put(`dup:${await huella(ip, mensaje)}`, '1', { expirationTtl: TTL_DUPLICADO });
}

async function verificarCaptcha(secreto, token, ip) {
  const formulario = new FormData();
  formulario.append('secret', secreto);
  formulario.append('response', token);
  if (ip) {
    formulario.append('remoteip', ip);
  }

  try {
    const respuesta = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formulario,
    });
    const resultado = await respuesta.json();
    return resultado.success === true;
  } catch {
    return false;
  }
}

async function guardarMensaje(almacen, datos, pais) {
  const id = 'msg:' + new Date().toISOString() + '-' + crypto.randomUUID();
  const registro = {
    nombre: datos.nombre,
    email: datos.email,
    mensaje: datos.mensaje,
    fecha: new Date().toISOString(),
    pais,
    consentimiento: true,
  };
  await almacen.put(id, JSON.stringify(registro), { expirationTtl: TTL_MENSAJE });
}

async function listarMensajes(env) {
  const listado = await env.MENSAJES.list({ prefix: 'msg:' });
  const claves = listado.keys.slice(-MAX_LISTA).reverse();
  const mensajes = [];

  for (const clave of claves) {
    const guardado = await env.MENSAJES.get(clave.name);
    if (guardado) {
      mensajes.push({ clave: clave.name, datos: JSON.parse(guardado) });
    }
  }

  return new Response(paginaMensajes(mensajes), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function origenValido(request) {
  const origen = request.headers.get('Origin');
  const permitidos = ['https://api.jesusefx.es', 'https://jesusefx.es'];

  if (origen) {
    return permitidos.includes(origen);
  }

  const referencia = request.headers.get('Referer') || '';
  return permitidos.some((base) => referencia.startsWith(base + '/'));
}

function redirigirAMensajes(request) {
  return Response.redirect(new URL('/mensajes', request.url).toString(), 303);
}

async function borrarMensaje(request, env) {
  if (!origenValido(request)) {
    return new Response('Origen no permitido', { status: 403 });
  }

  const formulario = await request.formData();
  const clave = String(formulario.get('clave') || '');
  if (!clave.startsWith('msg:')) {
    return new Response('Clave no válida', { status: 400 });
  }

  await env.MENSAJES.delete(clave);
  return redirigirAMensajes(request);
}

async function borrarTodos(request, env) {
  if (!origenValido(request)) {
    return new Response('Origen no permitido', { status: 403 });
  }

  const listado = await env.MENSAJES.list({ prefix: 'msg:' });
  for (const clave of listado.keys) {
    await env.MENSAJES.delete(clave.name);
  }

  return redirigirAMensajes(request);
}

function respuestaJson(objeto, codigo = 200, cabeceras = {}) {
  return new Response(JSON.stringify(objeto), {
    status: codigo,
    headers: { 'content-type': 'application/json', ...cabeceras },
  });
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (caracter) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[caracter]));
}

function paginaMensajes(mensajes) {
  const filas = mensajes.map(({ clave, datos }) => `
    <article>
      <header>
        <strong>${escaparHtml(datos.nombre)}</strong>
        <a href="mailto:${escaparHtml(datos.email)}">${escaparHtml(datos.email)}</a>
        <time>${escaparHtml(datos.fecha)}</time>
      </header>
      <p>${escaparHtml(datos.mensaje).replace(/\n/g, '<br>')}</p>
      <form method="post" action="/mensajes/borrar" data-confirmar="¿Borrar este mensaje?">
        <input type="hidden" name="clave" value="${escaparHtml(clave)}">
        <button type="submit">Borrar</button>
      </form>
    </article>`).join('');

  const total = mensajes.length;
  const texto = total === 1 ? '1 mensaje' : total + ' mensajes';

  return `<!doctype html>
<html lang="es"><meta charset="utf-8"><title>Mensajes · jesusefx.es</title>
<meta name="robots" content="noindex">
<style>
  body{margin:0;padding:32px 20px 80px;background:#0b0f14;color:#e8eef6;
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;line-height:1.6}
  main{max-width:760px;margin:0 auto}
  h1{font-size:1.4rem;font-weight:600;margin:0 0 6px}
  .total{color:#74879c;font-size:.85rem;margin:0 0 28px}
  article{border:1px solid #1e2a38;border-radius:10px;padding:16px 18px;margin-bottom:12px;background:#11161d}
  header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
  header a{color:#6fb1f0;text-decoration:none;font-size:.9rem}
  time{color:#74879c;font-size:.78rem;margin-left:auto}
  p{margin:0;color:#c6d3e0;font-size:.94rem}
  .vacio{color:#74879c}
  form{margin:12px 0 0}
  button{background:#1b2430;border:1px solid #2b3d52;color:#e8eef6;border-radius:6px;
         padding:5px 12px;font-size:.82rem;cursor:pointer;font-family:inherit}
  button:hover{border-color:#3a82cb}
  button.peligro{border-color:#7a2c35;color:#f0b3bb}
  button.peligro:hover{border-color:#b5434f}
</style>
<main>
  <h1>Mensajes</h1>
  <p class="total">${texto}</p>
  ${total > 0 ? `<form method="post" action="/mensajes/borrar-todos" data-confirmar="¿Borrar TODOS los mensajes? No se puede deshacer">
    <button class="peligro" type="submit">Borrar todos</button>
  </form>` : ''}
  ${filas || '<p class="vacio">No hay mensajes todavía.</p>'}
</main>
<script>
  document.querySelectorAll('form[data-confirmar]').forEach((formulario) => {
    formulario.addEventListener('submit', (evento) => {
      if (!confirm(formulario.dataset.confirmar)) {
        evento.preventDefault();
      }
    });
  });
</script>
</html>`;
}
