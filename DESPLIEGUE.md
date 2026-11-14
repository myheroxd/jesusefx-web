# Despliegue

Pasos para publicar cambios en el sitio. La documentación del montaje está en [README.md](README.md).

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html` | Portada, enlaces y formulario |
| `404.html` | Página de error |
| `worker.js` | Worker del formulario y del listado |

## 1. Subir el sitio

1. `dash.cloudflare.com` → **Workers & Pages** → Worker **`web`**.
2. **Create deployment** (o **Nueva implementación**) → **Upload assets**.
3. Arrastra la carpeta del proyecto. Debe contener `index.html` y `404.html` en la raíz.
4. **Deploy**.

Comprueba:

```sh
curl -sI https://<dominio> | head -1
curl -s https://<dominio>/no-existe | grep -o '<title>[^<]*'
```

## 2. Cambiar la Site Key de Turnstile

Si rotas el widget:

1. **Turnstile → <dominio> → Settings**: copia la nueva **Site Key** y la **Secret Key**.
2. En `index.html`, sustituye el valor de `data-sitekey`.
3. Vuelve a desplegar (paso 1).
4. En el Worker `contacto` → **Settings → Variables and Secrets**, actualiza el secreto `TURNSTILE_SECRET`.

## 3. Cambiar el Worker del formulario

1. Worker **`contacto`** → **Edit code**.
2. Sustituye el contenido por `worker.js`.
3. **Deploy**.

Comprueba:

```sh
curl -s https://api.<dominio>/ -w ' [%{http_code}]\n'
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

El Worker `web` tiene como dominio personalizado `<dominio>`. El Worker `contacto`, `api.<dominio>`.

**No añadas `*.<dominio>`**: el comodín intercepta `ssh.<dominio>` y rompe el túnel (ver README, sección 6.1).

## 6. Access

| Aplicación | Destino | Política |
|---|---|---|
| `ssh` | `ssh.<dominio>` | Allow por correo, PIN, 24 h |
| `Mensajes` | `api.<dominio>/mensajes` | Allow por correo, 24 h |

La ruta `/mensajes` es obligatoria. Si se protege todo `api.`, el formulario deja de funcionar para los visitantes.

## 7. Comprobación completa

```sh
dig <dominio> +short
curl -sI https://<dominio> | head -1
curl -sI https://www.<dominio> | grep -i location
curl -s https://api.<dominio>/ -w ' [%{http_code}]\n'
ssh casa-cf
```

Esperado: IPs de Cloudflare, `200`, `301` a la raíz, `404` JSON y el SSH funcionando.

## 8. Coste

Todo dentro del plan gratuito: Workers (100 000 peticiones/día), KV (1 GB), Turnstile y Access (50 usuarios).
