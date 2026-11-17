# Despliegue

Publicar cambios en `jesusefx.es`. La documentación del montaje está en [README.md](README.md).

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Portada, enlaces y formulario |
| `cv.html`, `cv.pdf` | CV público y descargable |
| `notas/` | Sección de notas: índice y artículos |
| `privacidad.html`, `aviso-legal.html` | Páginas legales |
| `404.html` | Página de error |
| `sitemap.xml` | Listado de URLs públicas |
| `robots.txt` | Reglas de rastreo |
| `<clave>.txt` | Clave de IndexNow |
| `worker.js` | Worker del formulario y del listado |
| `favicon.svg`, `favicon-*.png`, `apple-touch-icon.png` | Iconos |
| `site.webmanifest` | Manifest para móvil |

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
curl -sI https://jesusefx.es | head -1
curl -s https://jesusefx.es/sitemap.xml | head -3
curl -s https://jesusefx.es/no-existe | grep -o '<title>[^<]*'
```
