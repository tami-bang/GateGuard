#!/usr/bin/env bash
set -euo pipefail

ROOT="${HOME}/GateGuard"
LOGDIR="${ROOT}/scripts/logs"

stop_by_pidfile () {
  local name="$1"
  local pidfile="${LOGDIR}/${name}.pid"

  if [[ -f "${pidfile}" ]]; then
    local pid
    pid="$(cat "${pidfile}" || true)"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      echo "Stopping ${name} (pid=${pid})..."
      kill "${pid}" || true
      sleep 1
      kill -9 "${pid}" >/dev/null 2>&1 || true
    else
      echo "${name}: pidfile exists but process not running."
    fi
    rm -f "${pidfile}"
  else
    echo "${name}: pidfile not found."
  fi
}

stop_by_pidfile "fastapi"
stop_by_pidfile "django"
stop_by_pidfile "engine"

# 혹시 pidfile이 꼬였을 때 대비 (패턴 종료)
pkill -f "uvicorn .*main:app" >/dev/null 2>&1 || true
pkill -f "manage.py runserver 0.0.0.0:" >/dev/null 2>&1 || true
pkill -f "${ROOT}/engine_C/gg_engine" >/dev/null 2>&1 || true

echo "Done."
