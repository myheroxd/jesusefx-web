# Despliegue

Pasos para publicar cambios en `jesusefx.es`. La documentación del montaje está en [README.md](README.md).

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Portada, enlaces y formulario |
| `cv.html` | CV público, sin datos de contacto |
| `cv.pdf` | CV descargable |
| `404.html` | Página de error |
| `worker.js` | Worker del formulario y del listado |

## 1. Subir el sitio

1. `dash.cloudflare.com` → **Workers & Pages** → Worker **`web`**.
2. **Create deployment** (o **Nueva implementación**) → **Upload assets**.
3. Arrastra la carpeta del proyecto. Debe contener `index.html`, `404.html`, `cv.html` y `cv.pdf` en la raíz.
4. **Deploy**.

Comprueba:

```sh
curl -sI https://jesusefx.es | head -1
curl -s https://jesusefx.es/no-existe | grep -o '<title>[^<]*'
```

## 2. Cambiar la Site Key de Turnstile

Si rotas el widget:

1. **Turnstile → jesusefx.es → Settings**: copia la nueva **Site Key** y la **Secret Key**.
2. En `index.html`, sustituye el valor de `data-sitekey`.
3. Vuelve a desplegar (paso 1).
4. En el Worker `contacto` → **Settings → Variables and Secrets**, actualiza el secreto `TURNSTILE_SECRET`.

## 3. Cambiar el Worker del formulario

1. Worker **`contacto`** → **Edit code**.
2. Sustituye el contenido por `worker.js`.
3. **Deploy**.

Comprueba:

```sh
curl -s https://api.jesusefx.es/ -w ' [%{http_code}]\n'
# {"error":"no_encontrado"} [404]
```

## 4. KV y secretos

Solo si hay que recrearlos:

1. **Almacenamiento y bases de datos → KV → Create a namespace**: `mensajes`.
2. Worker `contacto` → **Settings → Variables and Secrets**:
   - KV: `MENSAJES` → namespace `mensajes`.
   - Secreto: `TURNSTILE_SECRET` → Secret Key de Turnstile.
3. Guardar y desplegar.

## 5. Dominio y rutas

El Worker `web` tiene como dominio personalizado `jesusefx.es`. El Worker `contacto`, `api.jesusefx.es`.

**No añadas `*.jesusefx.es`**: el comodín intercepta `ssh.jesusefx.es` y rompe el túnel (ver README, sección 6.1).

## 6. Access

| Aplicación | Destino | Política |
|---|---|---|
| `ssh` | `ssh.jesusefx.es` | Allow por correo, PIN, 24 h |
| `Mensajes` | `api.jesusefx.es/mensajes` | Allow por correo, 24 h |

La ruta `/mensajes` es obligatoria. Si se protege todo `api.`, el formulario deja de funcionar para los visitantes.

## 7. Comprobación completa

```sh
dig jesusefx.es +short
curl -sI https://jesusefx.es | head -1
curl -sI https://www.jesusefx.es | grep -i location
curl -s https://api.jesusefx.es/ -w ' [%{http_code}]\n'
ssh casa-cf
```

Esperado: IPs de Cloudflare, `200`, `301` a la raíz, `404` JSON y el SSH funcionando.

## 8. Coste

Todo dentro del plan gratuito: Workers (100 000 peticiones/día), KV (1 GB), Turnstile y Access (50 usuarios).
