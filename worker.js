// Worker de contacto para jesusefx.es
// Dominio: api.jesusefx.es  (Worker → Custom Domain)
// Rutas:  POST /contact   → formulario (Turnstile + KV)
//         GET  /mensajes  → lista de mensajes (protegida con Cloudflare Access)
//
// Bindings necesarios:
//   KV:     MENSAJES            (namespace)
//   Secret: TURNSTILE_SECRET    (clave secreta de Turnstile)

const ORIGEN = 'https://jesusefx.es';
const MAX_MENSAJE = 2000;

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
      return contact(request, env);
    }

    if (url.pathname === '/mensajes') {
      return mensajes(env);
    }

    return json({ error: 'no_encontrado' }, 404);
  },
};

async function contact(request, env) {
  if (request.method !== 'POST') return json({ error: 'metodo' }, 405, CORS);

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'json' }, 400, CORS);
  }

  const nombre = String(data.nombre || '').trim().slice(0, 100);
  const email = String(data.email || '').trim().slice(0, 200);
  const mensaje = String(data.mensaje || '').trim().slice(0, MAX_MENSAJE);
  const token = String(data['cf-turnstile-response'] || '');

  if (!nombre || !mensaje) return json({ error: 'campos' }, 400, CORS);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'email' }, 400, CORS);
  if (!token) return json({ error: 'captcha' }, 400, CORS);

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);

  const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  const result = await verify.json();
  if (!result.success) return json({ error: 'captcha' }, 403, CORS);

  const id = 'msg:' + new Date().toISOString() + '-' + crypto.randomUUID();
  await env.MENSAJES.put(id, JSON.stringify({
    nombre, email, mensaje,
    fecha: new Date().toISOString(),
    pais: request.cf?.country || '',
  }));

  return json({ ok: true }, 200, CORS);
}

async function mensajes(env) {
  const list = await env.MENSAJES.list({ prefix: 'msg:' });
  const keys = list.keys.slice(-200).reverse();
  const items = [];
  for (const k of keys) {
    const raw = await env.MENSAJES.get(k.name);
    if (raw) items.push(JSON.parse(raw));
  }
  return new Response(html(items), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function html(items) {
  const filas = items.map((m) => `
    <article>
      <header>
        <strong>${esc(m.nombre)}</strong>
        <a href="mailto:${esc(m.email)}">${esc(m.email)}</a>
        <time>${esc(m.fecha)}</time>
      </header>
      <p>${esc(m.mensaje).replace(/\n/g, '<br>')}</p>
    </article>`).join('');
  return `<!doctype html>
<html lang="es"><meta charset="utf-8"><title>Mensajes — jesusefx.es</title>
<meta name="robots" content="noindex">
<style>
  body{margin:0;padding:32px 20px 80px;background:#0b1220;color:#e6edf6;
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
  main{max-width:760px;margin:0 auto}
  h1{font-size:1.4rem;margin:0 0 6px}
  .n{color:#7f9dbb;font-size:.85rem;margin-bottom:26px}
  article{border:1px solid #1d3350;border-radius:10px;padding:16px 18px;margin-bottom:14px;background:#0d1727}
  header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}
  header a{color:#8fb4d9;text-decoration:none;font-size:.9rem}
  time{color:#5f7893;font-size:.78rem;margin-left:auto}
  p{margin:0;color:#c3d3e4;line-height:1.6;font-size:.94rem;white-space:normal}
  .vacio{color:#7f9dbb}
</style>
<main>
  <h1>Mensajes</h1>
  <p class="n">${items.length} mensaje${items.length === 1 ? '' : 's'}</p>
  ${filas || '<p class="vacio">No hay mensajes todavía.</p>'}
</main></html>`;
}
