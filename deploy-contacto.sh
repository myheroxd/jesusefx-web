#!/usr/bin/env bash
# Publica el Worker "contacto" (formulario y mensajes) sin tocar el sitio estático.
# Vive junto al Worker que despliega: web-jesusefx/deploy-contacto.sh
# Uso: ./deploy-contacto.sh [--comprobar]
set -euo pipefail

export PATH="$HOME/.local/share/dsh-tauri/runtime/bin:$PATH"

WS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIGEN="$WS/worker.js"
TOKEN_FILE="$HOME/.config/cloudflare/deploy-token"
CUENTA="0e1ecd6fae57c76cdd054e50f2d810b7"
NOMBRE="contacto"
COMPAT="2026-11-13"
API="https://api.cloudflare.com/client/v4/accounts/$CUENTA/workers/scripts/$NOMBRE"

echo "== 1/4 Comprobando credenciales"
if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "ERROR: falta $TOKEN_FILE"
  exit 1
fi

TOKEN="$(<"$TOKEN_FILE")"
if ! curl -s -H "Authorization: Bearer $TOKEN" https://api.cloudflare.com/client/v4/user/tokens/verify \
     | grep -q '"status":"active"'; then
  echo "ERROR: el token de despliegue no es válido o ha caducado."
  exit 1
fi
echo "   Token válido"

echo "== 2/4 Leyendo los enlaces del Worker"
AJUSTES="$(mktemp)"
trap 'rm -f "$AJUSTES"' EXIT

if ! curl -s -H "Authorization: Bearer $TOKEN" -o "$AJUSTES" "$API/settings"; then
  echo "ERROR: no se pudo leer la configuración del Worker."
  exit 1
fi

SALIDA="$(python3 - "$AJUSTES" <<'PY'
import json
import sys

datos = json.load(open(sys.argv[1]))
if not datos.get("success"):
    print("ERROR: " + json.dumps(datos.get("errors", [])))
    sys.exit(2)

enlaces = datos["result"].get("bindings", [])
almacen = next(
    (b["namespace_id"] for b in enlaces
     if b["type"] == "kv_namespace" and b["name"] == "MENSAJES"),
    "",
)
secreto = any(b["type"] == "secret_text" and b["name"] == "TURNSTILE_SECRET" for b in enlaces)
print(f"{almacen}|{'si' if secreto else 'no'}")
PY
)"

ALMACEN="${SALIDA%%|*}"
SECRETO="${SALIDA##*|}"

if [[ "$ALMACEN" == ERROR* || -z "$ALMACEN" ]]; then
  echo "ERROR: no encuentro el espacio KV MENSAJES."
  echo "$SALIDA"
  exit 1
fi

echo "   KV MENSAJES: $ALMACEN"
echo "   Secreto TURNSTILE_SECRET: $SECRETO"

if [[ "${1:-}" == "--comprobar" ]]; then
  echo "Solo comprobación: no se despliega nada."
  exit 0
fi

echo "== 3/4 Desplegando"
META="$(python3 - "$COMPAT" "$ALMACEN" <<'PY'
import json
import sys

print(json.dumps({
    "main_module": "worker.js",
    "compatibility_date": sys.argv[1],
    "bindings": [{
        "type": "kv_namespace",
        "name": "MENSAJES",
        "namespace_id": sys.argv[2],
    }],
}))
PY
)"

RESULTADO="$(mktemp)"
trap 'rm -f "$AJUSTES" "$RESULTADO"' EXIT

curl -s -X PUT "$API" \
  -H "Authorization: Bearer $TOKEN" \
  -F "metadata=$META;type=application/json" \
  -F "worker.js=@$ORIGEN;type=application/javascript+module" \
  -o "$RESULTADO"

python3 - "$RESULTADO" <<'PY'
import json
import sys

datos = json.load(open(sys.argv[1]))
if not datos.get("success"):
    print("ERROR al desplegar: " + json.dumps(datos.get("errors", [])))
    sys.exit(1)
print("   Desplegado: " + str(datos["result"].get("id", "ok")))
PY

echo "== 4/4 Comprobando"
CODIGO="$(curl -s -o /dev/null -w '%{http_code}' -m 15 https://api.jesusefx.es/mensajes)"
if [[ "$CODIGO" == "302" || "$CODIGO" == "403" ]]; then
  echo "   /mensajes responde $CODIGO (Cloudflare Access activo)"
else
  echo "AVISO: /mensajes responde $CODIGO; revisa la ruta y Access."
fi

if ! git -C "$WS" diff --quiet -- worker.js 2>/dev/null; then
  echo "   Aviso: worker.js tiene cambios sin commitear. Publica el sitio con ./deploy-web.sh para dejarlo en GitHub."
fi

echo "Listo."
