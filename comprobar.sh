#!/usr/bin/env bash
set -uo pipefail

BASE="${1:-https://jesusefx.es}"
SITEMAP="$BASE/sitemap.xml"
fallos=0

pedir() { curl -sS -m 20 "$1"; }
codigo() { curl -sS -o /dev/null -w '%{http_code}' -m 20 "$1"; }
tipo() { curl -sSI -m 20 "$1" | awk -F': ' 'tolower($1)=="content-type"{print $2}' | tr -d '\r'; }

echo "== Sitemap"
if ! xml="$(pedir "$SITEMAP")"; then
  echo "ERROR: no se pudo descargar $SITEMAP"
  exit 1
fi

urls="$(printf '%s\n' "$xml" | grep -oE '<loc>[^<]+</loc>' | sed -e 's|<loc>||' -e 's|</loc>||')"
total="$(printf '%s\n' "$xml" | grep -c '<loc>')"
lastmods="$(printf '%s\n' "$xml" | grep -c '<lastmod>')"

echo "URLs: $total · lastmod: $lastmods"
if [[ "$total" -ne "$lastmods" ]]; then
  echo "AVISO: hay URLs sin lastmod"
  fallos=$((fallos + 1))
fi

echo
printf '%-58s %-4s %-20s %s\n' "URL" "CÓD" "TIPO" "CANONICAL"
for u in $urls; do
  c="$(codigo "$u")"
  t="$(tipo "$u" | cut -d';' -f1 | xargs)"
  canon=""
  nota=""

  if [[ "$c" == "200" && "$t" == "text/html" ]]; then
    canon="$(pedir "$u" | grep -oE '<link rel="canonical" href="[^"]+"' | head -1 | sed -e 's/.*href="//' -e 's/"$//')"
  fi

  if [[ "$c" != "200" ]]; then
    nota="FALLO"
    fallos=$((fallos + 1))
  elif [[ -n "$canon" && "$canon" != "$u" ]]; then
    nota="CANONICAL DISTINTO"
    fallos=$((fallos + 1))
  fi

  printf '%-58s %-4s %-20s %s %s\n' "$u" "$c" "$t" "$canon" "$nota"
done

echo
echo "== Comprobaciones sueltas"
comprobar() {
  local ruta="$1" esperado="$2" c
  c="$(codigo "$BASE$ruta")"
  if [[ "$c" == "$esperado" ]]; then
    printf 'OK    %-24s %s\n' "$ruta" "$c"
  else
    printf 'FALLO %-24s %s (esperado %s)\n' "$ruta" "$c" "$esperado"
    fallos=$((fallos + 1))
  fi
}

comprobar / 200
comprobar /robots.txt 200
comprobar /sitemap.xml 200
comprobar /no-existe-123 404

echo
if [[ "$fallos" -eq 0 ]]; then
  echo "Todo correcto."
else
  echo "$fallos problema(s) encontrados."
  exit 1
fi
