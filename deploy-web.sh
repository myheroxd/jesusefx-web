#!/usr/bin/env bash
# Despliega jesusefx.es (Worker "web") desde este repositorio.
# Uso: ./deploy-web.sh ["mensaje del commit"]
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="/tmp/site-build-web"
ACCOUNT_ID="0e1ecd6fae57c76cdd054e50f2d810b7"
ZONE_ID="f24bb7bbe6b7b81da2f7d337b2281ea0"

FILES=(index.html 404.html cv.html cv.pdf cv-en.pdf privacidad.html aviso-legal.html
       robots.txt sitemap.xml estilo.css
       favicon.svg favicon-32.png favicon-192.png favicon-512.png
       apple-touch-icon.png site.webmanifest)

echo "== 1/5 Comprobando credenciales"
TOKEN_FILE="$HOME/.config/cloudflare/deploy-token"
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

echo "== 2/5 Preparando el paquete de despliegue"
rm -rf "$BUILD"
mkdir -p "$BUILD/public/.well-known"
for f in "${FILES[@]}"; do
  cp "$SRC/$f" "$BUILD/public/$f"
done
cp "$SRC/.well-known/discord" "$BUILD/public/.well-known/discord"
cp -a "$SRC/notas" "$BUILD/public/notas"
cp "$SRC/4f9c2d7a1b8e6c3f5a2d9e7b1c4f8a63.txt" "$BUILD/public/"

cat > "$BUILD/wrangler.jsonc" <<'JSON'
{
  "name": "web",
  "compatibility_date": "2026-11-14",
  "assets": {
    "directory": "./public",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page"
  },
  "workers_dev": false,
  "preview_urls": false
}
JSON

echo "== 3/5 Desplegando en Cloudflare"
cd "$BUILD"
CLOUDFLARE_API_TOKEN="$TOKEN" CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" \
  npx -y wrangler@4.164.0 deploy

echo "   Purgando la caché del dominio"
curl -s -o /dev/null -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"purge_everything":true}'

echo
echo "== 4/5 Comprobación"
for u in / /cv /cv.pdf /cv-en.pdf /privacidad /aviso-legal /notas/ /sitemap.xml /robots.txt; do
  printf '%-16s ' "$u"
  curl -s -o /dev/null -w '%{http_code}\n' "https://jesusefx.es$u"
done
printf '%-16s ' "404"
curl -s -o /dev/null -w '%{http_code}\n' https://jesusefx.es/no-existe

echo
echo "== 5/5 Sincronizando con GitHub"
cd "$SRC"
if [[ -z "$(git status --porcelain)" ]]; then
  echo "Sin cambios en el repositorio: nada que commitear."
else
  git add -A

  PELIGROSOS="$(git diff --cached --name-only | grep -E '(^|/)(\.env(\..*)?|.*\.pem|.*\.key|id_(rsa|ed25519)|deploy-token)$' || true)"
  if [[ -n "$PELIGROSOS" ]]; then
    echo "ERROR: hay ficheros que parecen secretos en el commit:"
    echo "$PELIGROSOS"
    echo "Quitados del índice; revisa antes de volver a desplegar."
    git reset -q
    exit 1
  fi

  if git diff --cached -U0 | grep -aE '^\+.*(BEGIN [A-Z ]*PRIVATE KEY|Bearer [A-Za-z0-9._-]{20,}|ghp_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,})' > /dev/null; then
    echo "ERROR: una línea añadida contiene algo que parece un token o una clave privada."
    echo "Commit cancelado; revisa los cambios."
    git reset -q
    exit 1
  fi

  MENSAJE="${1:-Despliegue automático $(date '+%Y-%m-%d %H:%M')}"
  git commit -q -m "$MENSAJE"
  echo "Commit creado: $(git log --oneline -1)"
fi

if [[ -z "$(git log --oneline origin/main..HEAD 2>/dev/null)" ]]; then
  echo "GitHub ya está al día."
else
  # Las credenciales de GitHub las resuelve `gh` (gh auth setup-git), que solo
  # responde para github.com. Si fallara el push, el aviso lo da git.
  if git push -q origin main 2>/dev/null; then
    echo "Subido a GitHub: $(git log --oneline -1)"
  else
    echo "AVISO: el despliegue está hecho, pero no se pudo subir a GitHub."
    echo "Para arreglarlo: gh auth status"
    exit 1
  fi
fi
