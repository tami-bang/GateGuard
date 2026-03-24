#!/usr/bin/env bash
set -u

TARGET_URL="${TARGET_URL:-http://192.168.1.24:8080}"
PROFILE="default"

RUN_FAIL_STAGE=0
LOOPS=3
SLEEP_SEC=1

usage() {
    cat <<USAGE
Usage:
  $0 [--profile workhours|lunch|afterhours|default]

Examples:
  $0
  $0 --profile workhours
  TARGET_URL=http://192.168.1.24:8080 $0 --profile lunch
USAGE
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

# --------------------------------------------------
# Policy-aligned traffic cases
# --------------------------------------------------

# ALLOW exact-match hosts (현재 등록한 allow 정책 기준)
ALLOW_HOSTS=(
    "google.com"
    "youtube.com"
    "naver.com"
    "kakao.com"
    "wikipedia.org"
    "amazon.com"
)

ALLOW_PATHS=(
    "/"
    "/"
    "/"
    "/"
    "/wiki/Main_Page"
    "/"
)

# BLOCK keyword/pattern-based hosts/paths
# 현재 BLOCK 정책:
# - HOST CONTAINS: bet, casino, slot, toto
# - HOST CONTAINS: porn, xxx, sex
# - HOST CONTAINS: login, verify, secure
# - PATH CONTAINS: account
BLOCK_HOSTS=(
    "casino-demo.local"
    "toto-guide.local"
    "slot-event.local"
    "bet-now.local"
    "porn-stream.local"
    "xxx-media.local"
    "secure-verify-login.local"
)

BLOCK_PATHS=(
    "/"
    "/"
    "/"
    "/"
    "/"
    "/"
    "/account/check"
)

# AI fallback traffic
# 정책에 안 걸리도록 일반/중립 host-path 사용
AI_HOSTS=(
    "docs.randomsite.local"
    "service-portal.local"
    "static-content.local"
    "news-center.local"
)

AI_PATHS=(
    "/home"
    "/help"
    "/assets/main.js"
    "/article/2026/overview"
)

# FAIL stage (afterhours 전용)
FAIL_HOST="aitest.gateguard.local"
FAIL_PATH="/score-check"

run_request() {
    local stage="$1"
    local host="$2"
    local path="$3"

    local result
    local code
    local total

    echo "[$(timestamp)] [TRAFFIC_GEN] request=${stage} host=${host} path=${path}"

    result="$(curl -sS -o /dev/null \
        -w '%{http_code} %{time_total}' \
        -H "Host: ${host}" \
        "${TARGET_URL}${path}" 2>/tmp/gateguard_traffic_err.$$)"
    local curl_rc=$?

    if [[ $curl_rc -ne 0 ]]; then
        echo "[$(timestamp)] [TRAFFIC_GEN] result=${stage} status=ERROR curl_rc=${curl_rc} detail=$(tr '\n' ' ' < /tmp/gateguard_traffic_err.$$)"
        rm -f /tmp/gateguard_traffic_err.$$
        return 1
    fi

    rm -f /tmp/gateguard_traffic_err.$$
    code="${result%% *}"
    total="${result##* }"

    echo "[$(timestamp)] [TRAFFIC_GEN] result=${stage} http_code=${code} time_total=${total}"
    return 0
}

echo "[$(timestamp)] [TRAFFIC_GEN] start profile=${PROFILE} target=${TARGET_URL} loops=${LOOPS} sleep=${SLEEP_SEC}s"
echo "[$(timestamp)] [TRAFFIC_GEN] allow_count=${#ALLOW_HOSTS[@]} block_count=${#BLOCK_HOSTS[@]} ai_count=${#AI_HOSTS[@]} run_fail_stage=${RUN_FAIL_STAGE}"

for ((i=1; i<=LOOPS; i++)); do
    echo "[$(timestamp)] [TRAFFIC_GEN] loop=${i}/${LOOPS} begin"

    # ALLOW stage
    for idx in "${!ALLOW_HOSTS[@]}"; do
        run_request "ALLOW" "${ALLOW_HOSTS[$idx]}" "${ALLOW_PATHS[$idx]}"
        sleep "${SLEEP_SEC}"
    done

    # BLOCK stage
    for idx in "${!BLOCK_HOSTS[@]}"; do
        run_request "BLOCK" "${BLOCK_HOSTS[$idx]}" "${BLOCK_PATHS[$idx]}"
        sleep "${SLEEP_SEC}"
    done

    # AI stage (policy miss -> AI fallback)
    for idx in "${!AI_HOSTS[@]}"; do
        run_request "AI" "${AI_HOSTS[$idx]}" "${AI_PATHS[$idx]}"
        sleep "${SLEEP_SEC}"
    done

    if [[ "${RUN_FAIL_STAGE}" -eq 1 ]]; then
        run_request "FAIL" "${FAIL_HOST}" "${FAIL_PATH}"
        sleep "${SLEEP_SEC}"
    fi

    echo "[$(timestamp)] [TRAFFIC_GEN] loop=${i}/${LOOPS} end"
done

echo "[$(timestamp)] [TRAFFIC_GEN] done profile=${PROFILE}"
