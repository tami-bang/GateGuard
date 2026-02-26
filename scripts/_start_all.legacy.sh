#!/usr/bin/env bash
set -euo pipefail

ROOT="${HOME}/GateGuard"
LOGDIR="${ROOT}/scripts/logs"
mkdir -p "${LOGDIR}"

FASTAPI_DIR="${ROOT}/fastapi"
ENGINE_DIR="${ROOT}/engine_C"
DJANGO_DIR="${ROOT}/admin_django"

FASTAPI_PORT="${FASTAPI_PORT:-8000}"
DJANGO_PORT="${DJANGO_PORT:-8001}"
ENGINE_IFACE="${ENGINE_IFACE:-enp0s3}"

echo "[1/4] Starting MariaDB..."
sudo systemctl start mariadb
sudo systemctl is-active --quiet mariadb && echo "mariadb: active" || (echo "mariadb: failed" && exit 1)

echo "[2/4] Starting FastAPI..."
if [[ ! -d "${FASTAPI_DIR}" ]]; then
  echo "ERROR: fastapi dir not found: ${FASTAPI_DIR}"
  exit 1
fi

# venv 활성화 (프로젝트에 venv 폴더가 있다고 했음)
if [[ ! -f "${FASTAPI_DIR}/venv/bin/activate" ]]; then
  echo "ERROR: FastAPI venv not found: ${FASTAPI_DIR}/venv/bin/activate"
  exit 1
fi

# 기존 uvicorn 있으면 종료
if pgrep -f "uvicorn .*main:app.*--port ${FASTAPI_PORT}" >/dev/null 2>&1; then
  echo "FastAPI already running on port ${FASTAPI_PORT} (uvicorn). Skipping start."
else
  (
    cd "${FASTAPI_DIR}"
    source venv/bin/activate
    nohup uvicorn main:app --host 0.0.0.0 --port "${FASTAPI_PORT}" \
      > "${LOGDIR}/fastapi.out" 2> "${LOGDIR}/fastapi.err" &
    echo $! > "${LOGDIR}/fastapi.pid"
  )
  echo "FastAPI started (port=${FASTAPI_PORT}). logs=${LOGDIR}/fastapi.out"
fi

echo "[3/4] Starting Django..."
if [[ -d "${DJANGO_DIR}" ]]; then
  # Django venv는 프로젝트마다 다를 수 있으니 2가지 케이스 지원
  DJ_VENV=""
  if [[ -f "${DJANGO_DIR}/venv/bin/activate" ]]; then DJ_VENV="${DJANGO_DIR}/venv/bin/activate"; fi
  if [[ -f "${DJANGO_DIR}/.venv/bin/activate" ]]; then DJ_VENV="${DJANGO_DIR}/.venv/bin/activate"; fi

  if [[ -z "${DJ_VENV}" ]]; then
    echo "WARN: Django venv not found (expected venv/bin/activate or .venv/bin/activate). Skipping Django start."
  else
    if pgrep -f "manage.py runserver 0.0.0.0:${DJANGO_PORT}" >/dev/null 2>&1; then
      echo "Django already running on port ${DJANGO_PORT}. Skipping start."
    else
      (
        cd "${DJANGO_DIR}"
        source "${DJ_VENV}"
        nohup python manage.py runserver "0.0.0.0:${DJANGO_PORT}" \
          > "${LOGDIR}/django.out" 2> "${LOGDIR}/django.err" &
        echo $! > "${LOGDIR}/django.pid"
      )
      echo "Django started (port=${DJANGO_PORT}). logs=${LOGDIR}/django.out"
    fi
  fi
else
  echo "WARN: admin_django dir not found: ${DJANGO_DIR}. Skipping Django start."
fi

echo "[4/4] Starting Engine..."
if [[ ! -x "${ENGINE_DIR}/gg_engine" ]]; then
  echo "ERROR: Engine binary not found or not executable: ${ENGINE_DIR}/gg_engine"
  echo "Hint: build it first in ${ENGINE_DIR}"
  exit 1
fi

# 기존 엔진 실행 중이면 종료
if pgrep -f "${ENGINE_DIR}/gg_engine ${ENGINE_IFACE}" >/dev/null 2>&1; then
  echo "Engine already running on iface ${ENGINE_IFACE}. Skipping start."
else
  (
    cd "${ENGINE_DIR}"
    # 엔진은 sudo 필요. nohup + sudo로 백그라운드 실행
    nohup sudo ./gg_engine "${ENGINE_IFACE}" \
      > "${LOGDIR}/engine.out" 2> "${LOGDIR}/engine.err" &
    echo $! > "${LOGDIR}/engine.pid"
  )
  echo "Engine started (iface=${ENGINE_IFACE}). logs=${LOGDIR}/engine.out"
fi

echo "Done."
echo "FastAPI:  http://127.0.0.1:${FASTAPI_PORT}/health"
echo "Django:   http://127.0.0.1:${DJANGO_PORT}/ (if started)"
echo "Logs:     ${LOGDIR}"
