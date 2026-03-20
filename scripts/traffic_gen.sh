#!/usr/bin/env bash

set -u

TARGET_URL="${TARGET_URL:-http://192.168.1.24:8080}"
LOOPS="${LOOPS:-3}"
SLEEP_SEC="${SLEEP_SEC:-1}"
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-3}"
MAX_TIME="${MAX_TIME:-5}"

PASS_HOST="${PASS_HOST:-good.example.com}"
PASS_PATH="${PASS_PATH:-/}"

BLOCK_HOST="${BLOCK_HOST:-example.com}"
BLOCK_PATH="${BLOCK_PATH:-/}"

AI_HOST="${AI_HOST:-test-ai.com}"
AI_PATH="${AI_PATH:-/gg-ai-test}"

FAIL_HOST="${FAIL_HOST:-aitest.gateguard.local}"
FAIL_PATH="${FAIL_PATH:-/score-check}"

SHOW_BODY="${SHOW_BODY:-0}"
RUN_FAIL_STAGE="${RUN_FAIL_STAGE:-0}"

log() {
    printf '[TRAFFIC_GEN] %s\n' "$1"
}

run_curl() {
    local label="$1"
    local host="$2"
    local path="$3"

    local url="${TARGET_URL}${path}"
    local tmp_body
    tmp_body="$(mktemp)"

    log "request=${label} host=${host} path=${path}"

    if curl -sS \
        --connect-timeout "${CONNECT_TIMEOUT}" \
        --max-time "${MAX_TIME}" \
        -H "Host: ${host}" \
        -o "${tmp_body}" \
        -w "[TRAFFIC_GEN] result=${label} http_code=%{http_code} time_total=%{time_total}\n" \
        "${url}"
    then
        :
    else
        log "curl failed for ${label}"
    fi

    if [ "${SHOW_BODY}" = "1" ]; then
        printf '%s\n' "----- body (${label}) -----"
        cat "${tmp_body}"
        printf '\n%s\n' "---------------------------"
    fi

    rm -f "${tmp_body}"
}

run_pass_set() {
    run_curl "PASS" "${PASS_HOST}" "${PASS_PATH}"
}

run_block_set() {
    run_curl "BLOCK" "${BLOCK_HOST}" "${BLOCK_PATH}"
}

run_ai_set() {
    run_curl "AI" "${AI_HOST}" "${AI_PATH}"
}

run_fail_set() {
    run_curl "FAIL_STAGE" "${FAIL_HOST}" "${FAIL_PATH}"
}

main() {
    local i=1

    log "start target=${TARGET_URL} loops=${LOOPS} sleep=${SLEEP_SEC}s"
    log "pass=${PASS_HOST}${PASS_PATH} block=${BLOCK_HOST}${BLOCK_PATH} ai=${AI_HOST}${AI_PATH} fail=${FAIL_HOST}${FAIL_PATH} run_fail_stage=${RUN_FAIL_STAGE}"

    while [ "${i}" -le "${LOOPS}" ]; do
        log "loop=${i}/${LOOPS} begin"

        run_pass_set
        sleep "${SLEEP_SEC}"

        run_block_set
        sleep "${SLEEP_SEC}"

        run_ai_set
        sleep "${SLEEP_SEC}"

        if [ "${RUN_FAIL_STAGE}" = "1" ]; then
            run_fail_set
            sleep "${SLEEP_SEC}"
        fi

        log "loop=${i}/${LOOPS} end"
        i=$((i + 1))
    done

    log "done"
}

main "$@"
