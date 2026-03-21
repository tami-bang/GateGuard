#!/usr/bin/env bash
set -u

TARGET_URL="${TARGET_URL:-http://192.168.1.24:8080}"
PROFILE="default"

PASS_HOST="${PASS_HOST:-good.example.com}"
PASS_PATH="${PASS_PATH:-/}"

BLOCK_HOST="${BLOCK_HOST:-example.com}"
BLOCK_PATH="${BLOCK_PATH:-/}"

AI_HOST="${AI_HOST:-test-ai.com}"
AI_PATH="${AI_PATH:-/gg-ai-test}"

FAIL_HOST="${FAIL_HOST:-aitest.gateguard.local}"
FAIL_PATH="${FAIL_PATH:-/score-check}"

RUN_FAIL_STAGE=0
LOOPS=3
SLEEP_SEC=1

usage() {
    cat <<EOF
Usage:
  $0 [--profile workhours|lunch|afterhours|default]

Examples:
  $0
  $0 --profile workhours
  TARGET_URL=http://192.168.1.24:8080 $0 --profile lunch
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --profile)
            PROFILE="${2:-default}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "[TRAFFIC_GEN] unknown argument: $1" >&2
            usage
            exit 1
            ;;
    esac
done

case "$PROFILE" in
    workhours)
        LOOPS=4
        SLEEP_SEC=1
        RUN_FAIL_STAGE=0
        ;;
    lunch)
        LOOPS=1
        SLEEP_SEC=2
        RUN_FAIL_STAGE=0
        ;;
    afterhours)
        LOOPS=2
        SLEEP_SEC=2
        RUN_FAIL_STAGE=1
        ;;
    default)
        LOOPS=3
        SLEEP_SEC=1
        RUN_FAIL_STAGE=0
        ;;
    *)
        echo "[TRAFFIC_GEN] invalid profile: $PROFILE" >&2
        exit 1
        ;;
esac

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

run_request() {
    local stage="$1"
    local host="$2"
    local path="$3"

    local code
    local total

    echo "[$(timestamp)] [TRAFFIC_GEN] request=${stage} host=${host} path=${path}"

    code="$(curl -sS -o /dev/null \
        -w '%{http_code}' \
        -H "Host: ${host}" \
        "${TARGET_URL}${path}" 2>/tmp/gateguard_traffic_err.$$)"
    local curl_rc=$?

    total="$(curl -sS -o /dev/null \
        -w '%{time_total}' \
        -H "Host: ${host}" \
        "${TARGET_URL}${path}" 2>/dev/null)"
    local time_rc=$?

    if [[ $curl_rc -ne 0 || $time_rc -ne 0 ]]; then
        echo "[$(timestamp)] [TRAFFIC_GEN] result=${stage} status=ERROR curl_rc=${curl_rc} detail=$(tr '\n' ' ' < /tmp/gateguard_traffic_err.$$)"
        rm -f /tmp/gateguard_traffic_err.$$
        return 1
    fi

    rm -f /tmp/gateguard_traffic_err.$$
    echo "[$(timestamp)] [TRAFFIC_GEN] result=${stage} http_code=${code} time_total=${total}"
    return 0
}

echo "[$(timestamp)] [TRAFFIC_GEN] start profile=${PROFILE} target=${TARGET_URL} loops=${LOOPS} sleep=${SLEEP_SEC}s"
echo "[$(timestamp)] [TRAFFIC_GEN] pass=${PASS_HOST}${PASS_PATH} block=${BLOCK_HOST}${BLOCK_PATH} ai=${AI_HOST}${AI_PATH} fail=${FAIL_HOST}${FAIL_PATH} run_fail_stage=${RUN_FAIL_STAGE}"

for ((i=1; i<=LOOPS; i++)); do
    echo "[$(timestamp)] [TRAFFIC_GEN] loop=${i}/${LOOPS} begin"

    run_request "PASS"  "$PASS_HOST"  "$PASS_PATH"
    sleep "${SLEEP_SEC}"

    run_request "BLOCK" "$BLOCK_HOST" "$BLOCK_PATH"
    sleep "${SLEEP_SEC}"

    run_request "AI"    "$AI_HOST"    "$AI_PATH"
    sleep "${SLEEP_SEC}"

    if [[ "${RUN_FAIL_STAGE}" -eq 1 ]]; then
        run_request "FAIL"  "$FAIL_HOST"  "$FAIL_PATH"
        sleep "${SLEEP_SEC}"
    fi

    echo "[$(timestamp)] [TRAFFIC_GEN] loop=${i}/${LOOPS} end"
done

echo "[$(timestamp)] [TRAFFIC_GEN] done profile=${PROFILE}"
