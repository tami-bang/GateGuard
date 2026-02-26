#!/usr/bin/env bash
set -euo pipefail

ROOT="${HOME}/GateGuard"

echo "mariadb:"
systemctl is-active mariadb || true
echo

echo "fastapi (uvicorn):"
pgrep -af "uvicorn .*main:app" || echo "not running"
echo

echo "django (runserver):"
pgrep -af "manage.py runserver 0.0.0.0:" || echo "not running"
echo

echo "engine:"
pgrep -af "${ROOT}/engine_C/gg_engine" || echo "not running"
