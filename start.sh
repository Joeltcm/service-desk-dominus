#!/bin/sh
set -e
echo "=== SoporteDesk Starting ==="
echo "PORT: ${PORT:-8080}"
echo "DB: $(echo $DATABASE_URL | sed 's|://.*@|://***@|')"
echo "Working dir: $(pwd)"
echo "Contents: $(ls /app/backend)"
exec python3 -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-8080}" --app-dir /app/backend
