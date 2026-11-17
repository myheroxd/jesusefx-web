const ORIGEN = 'https://jesusefx.es';
const MAX_NOMBRE = 100;
const MAX_EMAIL = 200;
const MAX_MENSAJE = 2000;
const MAX_LISTA = 200;
const TTL_MENSAJE = 31536000;

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
  };

  const error = validar(datos);
  if (error) {
    return respuestaJson({ error }, 400, CORS);
  }

  const captchaCorrecto = await verificarCaptcha(
    env.TURNSTILE_SECRET,
    datos.token,
    request.headers.get('CF-Connecting-IP')
  );
  if (!captchaCorrecto) {
    return respuestaJson({ error: 'captcha' }, 403, CORS);
  }

  await guardarMensaje(env.MENSAJES, datos, request.cf?.country || '');

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
