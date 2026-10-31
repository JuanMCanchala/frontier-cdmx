#!/usr/bin/env bash
# Baja tareas, trazas y notas del volumen /data del agente en Railway a data/railway/<fecha>/.
# Sin capturas PNG por defecto (pesan); CON_CAPTURAS=1 las incluye.
# Pueden traer texto del set oculto: data/ está fuera de git y no se sube.
# railway ssh pasa por una terminal que no respeta binarios: el tar viaja en base64.
set -euo pipefail
RAILWAY="${RAILWAY:-$(command -v railway || echo "$HOME/.local/bin/railway")}"
destino="data/railway/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$destino"
excluir="--exclude=*.png"
[ "${CON_CAPTURAS:-0}" = 1 ] && excluir=""
"$RAILWAY" ssh --service agente -- sh -c "tar czf - $excluir -C /data . | base64 -w0; echo" 2>/dev/null \
  | tr -d '\r' | base64 -d -i | tar xzf - -C "$destino"
echo "datos en $destino: $(ls "$destino/tasks" 2>/dev/null | wc -l) tareas"
