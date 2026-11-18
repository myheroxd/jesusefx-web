# Despliegue

Publicar cambios en `jesusefx.es`. La documentación del montaje está en [README.md](README.md).

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Portada, enlaces y formulario |
| `cv.html` | CV público en HTML |
| `cv.pdf`, `cv-en.pdf` | CV en PDF, versión compatible con ATS (español e inglés) |
| `notas/` | Sección de notas: índice y artículos |
| `privacidad.html`, `aviso-legal.html` | Páginas legales |
| `404.html` | Página de error |
| `sitemap.xml` | Listado de URLs públicas |
| `robots.txt` | Reglas de rastreo |
| `<clave>.txt` | Clave de IndexNow |
| `worker.js` | Worker del formulario y del listado |
| `favicon.svg`, `favicon-*.png`, `apple-touch-icon.png` | Iconos |
| `site.webmanifest` | Manifest para móvil |
| `estilo.css` | Hoja de estilos común de notas y legales |
| `comprobar.sh` | Comprueba el sitemap y las rutas publicadas |

## Publicar

```sh
./deploy-web.sh "mensaje del commit"
```

El script hace cinco cosas:

1. Comprueba que el token de despliegue sigue activo.
2. Copia los archivos del repositorio a `deploy-web/`.
3. Prepara el paquete con su `wrangler.jsonc`.
4. Despliega en Cloudflare y **purga la caché** del dominio.
5. Comprueba las rutas con `curl` y sube el commit a GitHub.

Si el token no es válido, se para antes de tocar producción.

## El Worker del formulario

El sitio estático y el Worker que gestiona el formulario (`contacto`) se publican por separado:

```sh
./deploy-contacto.sh            # desde la raíz del repositorio
```

Si estás en el directorio del harness:

```sh
./web-jesusefx/deploy-contacto.sh
```

Comprueba el token, lee los enlaces actuales (KV `MENSAJES` y el secreto `TURNSTILE_SECRET`),
sube `worker.js` conservándolos y verifica que `/mensajes` sigue detrás de Access.

- `./deploy-contacto.sh --comprobar` solo enseña el estado, sin desplegar.
- Si cambias `worker.js`, el commit se hace con `./deploy-web.sh`, que publica el repositorio.

## Token

Vive en `~/.config/cloudflare/deploy-token`, con permisos 600 y fuera del repositorio. Necesita dos permisos: **Workers Scripts: Edit** y **Cache Purge**.

## Añadir una página

1. Crea el HTML con su `canonical`, `description` y Open Graph.
2. Añádela a `sitemap.xml` con su `lastmod`.
3. Enlázala desde `/notas/` o desde la portada.
4. Publica con el script.
5. En Search Console: *Inspección de URL* → **Solicitar indexación**.
6. Opcional: enviar las URLs nuevas a IndexNow.

## Comprobar

```sh
./comprobar.sh
```

Recorre el sitemap, pide cada URL y comprueba que responde 200 con el `canonical`
correcto, que todas tienen `lastmod`, que `robots.txt` y el sitemap se sirven y que
una ruta inexistente devuelve 404. Sale con código 1 si algo falla, así que sirve
para encadenarlo después de publicar:

```sh
./deploy-web.sh "cambio" && ./web-jesusefx/comprobar.sh
```
