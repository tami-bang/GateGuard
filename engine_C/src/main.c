#include "policy.h"
#include "packet_manager.h"
#include "http_response_injector.h"
#include "engine_struct.h"
#include "url_classification_client.h"
#include "decision_manager.h"
#include "db_function.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <stdint.h>
#include <sys/time.h>
#include <uuid/uuid.h>
#include <mysql/mysql.h>

#define ENGINE_LOG_PREFIX "[ENGINE]"
#define POLICY_LOG_PREFIX "[POLICY]"
#define AI_LOG_PREFIX     "[AI]"
#define INJECT_LOG_PREFIX "[INJECT]"
#define ERROR_LOG_PREFIX  "[ERROR]"

/*
 * GateGuard Engine main flow
 *
 * 1) packet_manager_run()
 *    - 지정 인터페이스에서 HTTP 요청 패킷 캡처
 *
 * 2) engine_handle_http_event()
 *    - 관리 UI / 내부 noise 요청 제외
 *    - access_log 기본 row 생성
 *    - 정책 캐시 기반 정책 매칭
 *
 * 3) policy match 결과 처리
 *    - BLOCK  -> 즉시 403 + RST injection 후 decision 반영
 *    - ALLOW  -> access_log decision 갱신
 *    - REVIEW -> access_log decision 갱신
 *
 * 4) policy 미매칭 시 AI scoring
 *    - FastAPI /v1/score 호출
 *    - ai_analysis 저장
 *    - FAIL_STAGE fallback 처리
 *
 * 5) AI 최종 판단 처리
 *    - BLOCK  -> 즉시 inject 후 decision 갱신
 *    - ALLOW  -> decision 갱신
 *    - REVIEW -> decision 갱신
 *
 * 주의:
 * 이 엔진은 OOB(out-of-band) 스니핑 기반 구조이므로
 * forged 403가 항상 원본 서버 응답보다 먼저 도달한다고 보장되지는 않는다.
 * 다만 inject를 최대한 앞당겨 선행 가능성을 높인다.
 */

/* ------------------------- */
/* runtime config helpers    */
/* ------------------------- */

static const char* get_env_str(const char* key, const char* def)
{
    const char* v = getenv(key);
    if (!v || !v[0]) return def;
    return v;
}

static int get_env_int(const char* key, int def)
{
    const char* v = getenv(key);
    if (!v || !v[0]) return def;

    char* end = NULL;
    long n = strtol(v, &end, 10);
    if (end == v || *end != '\0') return def;
    return (int)n;
}

static double get_env_double(const char* key, double def)
{
    const char* v = getenv(key);
    if (!v || !v[0]) return def;

    char* end = NULL;
    double n = strtod(v, &end);
    if (end == v || *end != '\0') return def;
    return n;
}

static int64_t now_ms(void)
{
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (int64_t)tv.tv_sec * 1000 + (int64_t)tv.tv_usec / 1000;
}

static int calc_engine_latency_ms(const HttpEvent* ev)
{
    if (!ev || ev->detect_ts_ms <= 0) return -1;

    int64_t cur = now_ms();
    if (cur < ev->detect_ts_ms) return 0;

    return (int)(cur - ev->detect_ts_ms);
}

static void build_score_endpoint(char* out, size_t outsz)
{
    const char* base = get_env_str("AI_BASE_URL", "http://127.0.0.1:8000");

    if (!out || outsz == 0) return;

    out[0] = '\0';

    size_t len = strlen(base);
    int n;

    if (len > 0 && base[len - 1] == '/') {
        n = snprintf(out, outsz, "%sv1/score", base);
    } else {
        n = snprintf(out, outsz, "%s/v1/score", base);
    }

    if (n < 0 || (size_t)n >= outsz) {
        if (outsz > 0) {
            out[outsz - 1] = '\0';
        }
    }
}

static const char* safe_str(const char* s)
{
    return (s && s[0]) ? s : "-";
}

static const char* action_to_text(action_t action)
{
    switch (action) {
        case ACT_ALLOW:    return "ALLOW";
        case ACT_BLOCK:    return "BLOCK";
        case ACT_REDIRECT: return "REDIRECT";
        case ACT_REVIEW:   return "REVIEW";
        default:           return "UNKNOWN";
    }
}

static void log_engine_decision(const HttpEvent* ev,
                                const char* decision,
                                const char* stage,
                                const char* reason)
{
    fprintf(stderr,
            "%s decision host=%s path=%s decision=%s stage=%s reason=%s\n",
            ENGINE_LOG_PREFIX,
            safe_str(ev ? ev->host : NULL),
            safe_str(ev ? ev->path : NULL),
            safe_str(decision),
            safe_str(stage),
            safe_str(reason));
}

/* ------------------------- */
/* 내부/관리 UI 노이즈 필터     */
/* ------------------------- */

static int starts_with_path(const char* path, const char* prefix)
{
    if (!path || !prefix) return 0;

    size_t n = strlen(prefix);
    return strncmp(path, prefix, n) == 0;
}

static int contains_text(const char* s, const char* needle)
{
    if (!s || !needle || !needle[0]) return 0;
    return strstr(s, needle) != NULL;
}

static int contains_admin_next_param(const char* path)
{
    if (!path || !path[0]) return 0;

    return (
        starts_with_path(path, "/?next=") ||
        strstr(path, "?next=") != NULL ||
        strstr(path, "&next=") != NULL
    );
}

static int is_internal_admin_host(const char* host)
{
    if (!host || !host[0]) return 0;

    return (
        strcasecmp(host, "localhost") == 0 ||
        strcasecmp(host, "127.0.0.1") == 0 ||
        strcasecmp(host, "192.168.1.24") == 0 ||
        strcasecmp(host, "localhost:8080") == 0 ||
        strcasecmp(host, "127.0.0.1:8080") == 0 ||
        strcasecmp(host, "192.168.1.24:8080") == 0
    );
}

static int is_internal_admin_path(const char* path)
{
    if (!path || !path[0]) return 0;

    return (
        starts_with_path(path, "/dashboard")   ||
        starts_with_path(path, "/logs")        ||
        starts_with_path(path, "/policies")    ||
        starts_with_path(path, "/incidents")   ||
        starts_with_path(path, "/ai-analysis") ||
        starts_with_path(path, "/audit-log")   ||
        starts_with_path(path, "/users")       ||
        starts_with_path(path, "/settings")    ||
        starts_with_path(path, "/login")       ||
        starts_with_path(path, "/sign-up")     ||
        strcmp(path, "/api/auth") == 0         ||
        starts_with_path(path, "/api/auth/")   ||
        strcmp(path, "/favicon.ico") == 0      ||
        contains_admin_next_param(path)
    );
}

static int is_next_internal_request(const char* path)
{
    if (!path || !path[0]) return 0;

    if (contains_text(path, "_rsc=")) return 1;
    if (starts_with_path(path, "/_next/")) return 1;

    return 0;
}

static int is_admin_noise_path(const char* path)
{
    if (!path || !path[0]) return 0;

    return (
        is_internal_admin_path(path) ||
        is_next_internal_request(path)
    );
}

static int is_dev_ai_test_request(const HttpEvent* ev)
{
    if (!ev) return 0;
    if (!ev->path) return 0;

    /*
     * 데모용 테스트 요청은 8080으로 들어오더라도 noise 제외 대상이 아니다.
     * 외부 Windows -> VM 테스트에서도 그대로 통과되어야 한다.
     */
    if ((int)ev->meta.server_port != 8080) return 0;

    return (
        strcmp(ev->path, "/score-check") == 0 ||
        strcmp(ev->path, "/test-ai") == 0 ||
        strcmp(ev->path, "/gg-ai-test") == 0
    );
}

static int is_ai_test_signature(const HttpEvent* ev)
{
    if (!ev) return 0;

    if (strcmp(safe_str(ev->meta.client_ip), "127.0.0.1") != 0 &&
        strcmp(safe_str(ev->meta.client_ip), "192.168.1.24") != 0) {
        return 0;
    }

    if (!ev->host || strcasecmp(ev->host, "aitest.gateguard.local") != 0) {
        return 0;
    }

    if (!ev->method || strcmp(ev->method, "GET") != 0) {
        return 0;
    }

    if (!ev->path || strcmp(ev->path, "/score-check") != 0) {
        return 0;
    }

    return 1;
}

static int is_internal_admin_request(const HttpEvent* ev)
{
    if (!ev) return 0;

    /*
     * 외부 정상 웹사이트 트래픽도 8080으로 들어올 수 있으므로
     * server_port만으로 admin 요청으로 보면 안 된다.
     *
     * 아래 중 하나면 admin 성격 요청으로 본다.
     * 1) Host header가 내부 admin host
     * 2) 8080으로 들어왔고 path가 admin/next 내부 요청 형태
     */
    if (is_internal_admin_host(ev->host)) {
        return 1;
    }

    if ((int)ev->meta.server_port == 8080 &&
        (is_internal_admin_path(ev->path) || is_next_internal_request(ev->path))) {
        return 1;
    }

    return 0;
}

static int should_skip_noise_event(const HttpEvent* ev)
{
    if (!ev) return 1;

    if (is_dev_ai_test_request(ev)) {
        return 0;
    }

    if (is_ai_test_signature(ev)) {
        return 0;
    }

    /*
     * 외부 정상 사이트의 /login, /favicon.ico, /_next/, _rsc 요청까지
     * 전역 제외하면 안 되므로 admin 성격이 확인된 요청만 skip
     */
    if (is_internal_admin_request(ev) && is_admin_noise_path(ev->path)) {
        return 1;
    }

    return 0;
}

static int should_bypass_policy_for_ai_test(const HttpEvent* ev)
{
    return is_ai_test_signature(ev);
}

/* ------------------------- */
/* globals                   */
/* ------------------------- */

static MYSQL* g_conn = NULL;
static policy_cache_t g_cache;

/* ------------------------- */
/* DB 연결                   */
/* ------------------------- */

static MYSQL* db_connect(void)
{
    const char* db_host = get_env_str("DB_HOST", "127.0.0.1");
    int db_port = get_env_int("DB_PORT", 3306);
    const char* db_user = get_env_str("DB_USER", "gateguard");
    const char* db_pass = get_env_str("DB_PASSWORD", "");
    const char* db_name = get_env_str("DB_NAME", "gateguard");

    MYSQL* conn = mysql_init(NULL);
    if (!conn) {
        fprintf(stderr, "%s mysql_init failed\n", ERROR_LOG_PREFIX);
        exit(1);
    }

    mysql_options(conn, MYSQL_SET_CHARSET_NAME, "utf8mb4");

    unsigned int proto = MYSQL_PROTOCOL_TCP;
    mysql_options(conn, MYSQL_OPT_PROTOCOL, &proto);

    if (!mysql_real_connect(conn, db_host, db_user, db_pass, db_name, (unsigned int)db_port, NULL, 0)) {
        fprintf(stderr,
                "%s mysql connect failed: host=%s port=%d user=%s db=%s err=%s\n",
                ERROR_LOG_PREFIX,
                db_host,
                db_port,
                db_user,
                db_name,
                mysql_error(conn));
        mysql_close(conn);
        exit(1);
    }

    fprintf(stderr,
            "%s db connected: host=%s port=%d user=%s db=%s\n",
            ENGINE_LOG_PREFIX,
            db_host,
            db_port,
            db_user,
            db_name);

    return conn;
}

static const char* ai_error_to_code(const ai_result_t* ar, char* out, size_t outsz)
{
    if (!out || outsz == 0) return "";
    out[0] = '\0';

    if (!ar) {
        snprintf(out, outsz, "AI_EMPTY");
        return out;
    }

    switch (ar->error_code) {
        case AI_OK:
            snprintf(out, outsz, "OK");
            break;
        case AI_ERR_TIMEOUT:
            snprintf(out, outsz, "AI_TIMEOUT");
            break;
        case AI_ERR_HTTP:
            if (ar->http_status > 0) snprintf(out, outsz, "AI_HTTP_%d", ar->http_status);
            else snprintf(out, outsz, "AI_HTTP");
            break;
        case AI_ERR_PARSE:
            snprintf(out, outsz, "AI_RESPONSE_INVALID");
            break;
        case AI_ERR_CURL:
            snprintf(out, outsz, "AI_CURL");
            break;
        case AI_ERR_EMPTY:
        default:
            snprintf(out, outsz, "AI_EMPTY");
            break;
    }

    return out;
}

/* ------------------------- */
/* 핵심 엔진 처리             */
/* ------------------------- */

void engine_handle_http_event(const HttpEvent* ev)
{
    if (!ev || !ev->is_http) return;

    fprintf(stderr,
            "%s request host=%s path=%s method=%s client_ip=%s server_ip=%s server_port=%u\n",
            ENGINE_LOG_PREFIX,
            safe_str(ev->host),
            safe_str(ev->path),
            safe_str(ev->method),
            safe_str(ev->meta.client_ip),
            safe_str(ev->meta.server_ip),
            (unsigned)ev->meta.server_port);

    if (should_skip_noise_event(ev)) {
        fprintf(stderr,
                "%s skip noise host=%s path=%s port=%u\n",
                ENGINE_LOG_PREFIX,
                safe_str(ev->host),
                safe_str(ev->path),
                (unsigned)ev->meta.server_port);
        return;
    }

    uuid_t uuid;
    uuid_generate(uuid);

    char request_id[37];
    uuid_unparse(uuid, request_id);

    fprintf(stderr,
            "%s access_log insert start request_id=%s host=%s path=%s\n",
            ENGINE_LOG_PREFIX,
            request_id,
            safe_str(ev->host),
            safe_str(ev->path));

    long long log_id =
        insert_access_log(g_conn,
                          request_id,
                          ev->meta.client_ip,
                          (int)ev->meta.client_port,
                          ev->meta.server_ip,
                          (int)ev->meta.server_port,
                          ev->host,
                          ev->path,
                          ev->method,
                          ev->url_norm);

    if (log_id < 0) {
        fprintf(stderr,
                "%s access_log insert failed: request_id=%s client_ip=%s host=%s path=%s\n",
                ERROR_LOG_PREFIX,
                request_id,
                safe_str(ev->meta.client_ip),
                safe_str(ev->host),
                safe_str(ev->path));
        return;
    }

    fprintf(stderr,
            "%s access_log insert done request_id=%s log_id=%lld\n",
            ENGINE_LOG_PREFIX,
            request_id,
            log_id);

    policy_decision_t d =
        match_policy(&g_cache,
                     ev->host,
                     ev->path,
                     ev->url_norm);

    if (should_bypass_policy_for_ai_test(ev)) {
        memset(&d, 0, sizeof(d));
    }

    if (d.matched) {
        fprintf(stderr,
                "%s matched log_id=%lld policy_id=%lld action=%s host=%s path=%s\n",
                POLICY_LOG_PREFIX,
                log_id,
                d.policy_id,
                action_to_text(d.action),
                safe_str(ev->host),
                safe_str(ev->path));

        if (d.action == ACT_BLOCK) {
            /*
             * POLICY BLOCK fast path
             * - access_log row는 이미 생성됨
             * - policy 기반 차단은 AI/후처리 없이 즉시 inject 가능
             * - 403 선점 가능성을 조금이라도 높이기 위해
             *   inject를 decision/update보다 먼저 수행
             */
            http_response_inject(ev, g_conn, log_id, d.block_status_code);

            update_access_log_decision(
                g_conn,
                log_id,
                "BLOCK",
                "POLICY",
                "POLICY_STAGE",
                d.policy_id,
                calc_engine_latency_ms(ev)
            );

            (void)insert_review_event_if_needed(g_conn, log_id, "POLICY_STAGE");
            log_engine_decision(ev, "BLOCK", "POLICY_STAGE", "POLICY");
            return;
        }

        if (d.action == ACT_ALLOW) {
            update_access_log_decision(
                g_conn,
                log_id,
                "ALLOW",
                "POLICY",
                "POLICY_STAGE",
                d.policy_id,
                calc_engine_latency_ms(ev)
            );
            log_engine_decision(ev, "ALLOW", "POLICY_STAGE", "POLICY");
            return;
        }

        if (d.action == ACT_REDIRECT) {
            /*
             * 현재 엔진은 redirect injection 미구현 상태이므로
             * REVIEW로 다운그레이드 처리
             */
            update_access_log_decision(
                g_conn,
                log_id,
                "REVIEW",
                "POLICY",
                "POLICY_STAGE",
                d.policy_id,
                calc_engine_latency_ms(ev)
            );
            log_engine_decision(ev, "REVIEW", "POLICY_STAGE", "POLICY");
            return;
        }

        if (d.action == ACT_REVIEW) {
            update_access_log_decision(
                g_conn,
                log_id,
                "REVIEW",
                "POLICY",
                "POLICY_STAGE",
                d.policy_id,
                calc_engine_latency_ms(ev)
            );
            log_engine_decision(ev, "REVIEW", "POLICY_STAGE", "POLICY");
            return;
        }

        fprintf(stderr,
                "%s matched policy but unknown action=%s host=%s path=%s\n",
                ENGINE_LOG_PREFIX,
                action_to_text(d.action),
                safe_str(ev->host),
                safe_str(ev->path));
    }

    ai_result_t ar;
    memset(&ar, 0, sizeof(ar));

    int ok = ai_classify_url_ex(ev, request_id, &ar);

    if (ar.model_version[0] == '\0') {
        strncpy(ar.model_version, "unknown", sizeof(ar.model_version) - 1);
        ar.model_version[sizeof(ar.model_version) - 1] = '\0';
    }

    char err_code[32];
    const char* ec = NULL;

    if (!ok) {
        ai_error_to_code(&ar, err_code, sizeof(err_code));
        ec = err_code;
    }

    {
        int ai_saved = insert_ai_analysis_auto_seq(g_conn, log_id, &ar, ok ? 1 : 0, ec);
        if (ai_saved != 0) {
            fprintf(stderr,
                    "%s ai_analysis insert failed: log_id=%lld request_id=%s ok=%d host=%s path=%s score=%.4f label=%s model_version=%s error_code=%s\n",
                    ERROR_LOG_PREFIX,
                    log_id,
                    request_id,
                    ok,
                    safe_str(ev->host),
                    safe_str(ev->path),
                    ar.score,
                    safe_str(ar.label),
                    safe_str(ar.model_version),
                    safe_str(ec));

            update_access_log_decision(
                g_conn,
                log_id,
                "REVIEW",
                "SYSTEM",
                "FAIL_STAGE",
                0,
                calc_engine_latency_ms(ev)
            );
            log_engine_decision(ev, "REVIEW", "FAIL_STAGE", "SYSTEM");
            return;
        }
    }

    if (!ok) {
        fprintf(stderr,
                "%s classify failed: log_id=%lld request_id=%s error_code=%s host=%s path=%s\n",
                AI_LOG_PREFIX,
                log_id,
                request_id,
                ec ? ec : "AI_EMPTY",
                safe_str(ev->host),
                safe_str(ev->path));

        update_access_log_decision(
            g_conn,
            log_id,
            "REVIEW",
            "SYSTEM",
            "FAIL_STAGE",
            0,
            calc_engine_latency_ms(ev)
        );
        log_engine_decision(ev, "REVIEW", "FAIL_STAGE", "SYSTEM");
        return;
    }

    double threshold = get_env_double("THRESHOLD", 0.50);
    action_t final = decision_manager_decide(&ar, threshold);

    fprintf(stderr,
            "%s classify result: log_id=%lld score=%.4f label=%s threshold=%.2f final=%s host=%s path=%s\n",
            AI_LOG_PREFIX,
            log_id,
            ar.score,
            safe_str(ar.label),
            threshold,
            action_to_text(final),
            safe_str(ev->host),
            safe_str(ev->path));

    if (final == ACT_BLOCK) {
        /*
         * AI BLOCK fast path
         * - 최종 판정이 끝난 즉시 inject 우선
         * - decision/update 및 review_event는 그 다음
         */
        http_response_inject(ev, g_conn, log_id, GG_DEFAULT_BLOCK_STATUS_CODE);

        update_access_log_decision(
            g_conn,
            log_id,
            "BLOCK",
            "AI",
            "AI_STAGE",
            0,
            calc_engine_latency_ms(ev)
        );
        (void)insert_review_event_if_needed(g_conn, log_id, "AI_STAGE");
        log_engine_decision(ev, "BLOCK", "AI_STAGE", "AI");
    }
    else if (final == ACT_ALLOW) {
        update_access_log_decision(
            g_conn,
            log_id,
            "ALLOW",
            "AI",
            "AI_STAGE",
            0,
            calc_engine_latency_ms(ev)
        );
        log_engine_decision(ev, "ALLOW", "AI_STAGE", "AI");
    }
    else {
        update_access_log_decision(
            g_conn,
            log_id,
            "REVIEW",
            "AI",
            "AI_STAGE",
            0,
            calc_engine_latency_ms(ev)
        );
        log_engine_decision(ev, "REVIEW", "AI_STAGE", "AI");
    }
}

/* ------------------------- */
/* main                      */
/* ------------------------- */

int main(int argc, char** argv)
{
    const char* ifname = get_env_str("CAP_IFACE", "enp0s3");
    if (argc >= 2 && argv[1] && argv[1][0]) {
        ifname = argv[1];
    }

    const char* db_host = get_env_str("DB_HOST", "127.0.0.1");
    int db_port = get_env_int("DB_PORT", 3306);
    const char* db_user = get_env_str("DB_USER", "gateguard");
    const char* db_name = get_env_str("DB_NAME", "gateguard");
    const char* api_token = get_env_str("API_TOKEN", "GateGuard1234!");

    char score_endpoint[256];
    memset(score_endpoint, 0, sizeof(score_endpoint));
    build_score_endpoint(score_endpoint, sizeof(score_endpoint));

    fprintf(stderr, "%s start\n", ENGINE_LOG_PREFIX);
    fprintf(stderr,
            "%s config: iface=%s db_host=%s db_port=%d db_user=%s db_name=%s ai_url=%s\n",
            ENGINE_LOG_PREFIX,
            ifname,
            db_host,
            db_port,
            db_user,
            db_name,
            score_endpoint);

    g_conn = db_connect();

    if (load_policy_cache(&g_cache,
                          db_host,
                          db_port,
                          db_user,
                          get_env_str("DB_PASSWORD", ""),
                          db_name) != 0) {
        fprintf(stderr, "%s policy load failed\n", ERROR_LOG_PREFIX);
    }

    fprintf(stderr, "%s policy loaded: %zu\n", POLICY_LOG_PREFIX, g_cache.policy_count);

    ai_client_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    snprintf(cfg.endpoint, sizeof(cfg.endpoint), "%s", score_endpoint);
    snprintf(cfg.token, sizeof(cfg.token), "%s", api_token);
    cfg.connect_timeout_ms = 1500;
    cfg.timeout_ms = 3000;

    if (!ai_client_init(&cfg)) {
        fprintf(stderr, "%s ai_client_init failed\n", ERROR_LOG_PREFIX);
    } else {
        fprintf(stderr, "%s client initialized: endpoint=%s\n", AI_LOG_PREFIX, score_endpoint);
    }

    packet_manager_run(ifname);

    ai_client_cleanup();
    free_policy_cache(&g_cache);

    if (g_conn) {
        mysql_close(g_conn);
        g_conn = NULL;
    }

    fprintf(stderr, "%s shutdown\n", ENGINE_LOG_PREFIX);
    return 0;
}
