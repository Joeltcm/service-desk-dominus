#!/usr/bin/env bash
# Despliega ESTE repo a Dominus Tech, y solo a Dominus Tech.
#
# `railway up` sube la CARPETA y la manda al proyecto que el CLI tenga enlazado
# para este directorio. Ese enlace vive en ~/.railway/config.json y puede cambiar
# sin aviso (un `railway link` en otro lado, un config recreado). Este script
# comprueba el destino ANTES de subir nada y aborta si no es el esperado.
set -euo pipefail

EXPECTED_ID="afb11b9b-03d5-4d63-9431-55fdfcbb3fc6"
EXPECTED_NAME="sde-dominus-tech"
URL="https://servicedesk.dominuspty.com"

cd "$(dirname "$0")"

read -r actual_id actual_name < <(
  railway status --json 2>/dev/null |
  python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id',''), d.get('name',''))"
) || { echo "✖ No se pudo leer el estado de Railway. ¿Sesión iniciada? (railway login)"; exit 1; }

if [[ "$actual_id" != "$EXPECTED_ID" ]]; then
  echo "✖ ABORTADO — esta carpeta NO está enlazada a Dominus."
  echo "   esperado: $EXPECTED_NAME ($EXPECTED_ID)"
  echo "   actual:   ${actual_name:-?} (${actual_id:-sin enlace})"
  echo
  echo "   Corregir con:"
  echo "   railway link -p $EXPECTED_ID -s app -e production"
  exit 1
fi

echo "───────────────────────────────────────────────"
echo " DESTINO: $EXPECTED_NAME  ← PRODUCCIÓN DEL CLIENTE"
echo " URL:     $URL"
echo "───────────────────────────────────────────────"
echo
read -r -p 'Esto afecta a un cliente en producción. Escribe DOMINUS para confirmar: ' answer
[[ "$answer" == "DOMINUS" ]] || { echo "Cancelado."; exit 1; }

railway up
