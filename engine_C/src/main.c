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
#include <uuid/uuid.h>
#include <mysql/mysql.h>

/* DB 설정 */
#define DB_HOST "127.0.0.1"
#define DB_PORT 3306
#define DB_USER "gateguard"
#define DB_PASS "gateguard1234!"
#define DB_NAME "gateguard"

/* AI API 설정 */
#define API_URL   "http://127.0.0.1:8000/v1/score"
#define API_TOKEN "changeme-token"

/* Threshold */
#define DEFAULT_THRESHOLD 0.5

static MYSQL* g_conn = NULL;
static policy_cache_t g_cache;

/* =========================
DB 연결
========================= */
static MYSQL* db_connect(void)
{
    MYSQL* conn = mysql_init(NULL);
    if (!conn) {
        fprintf(stderr, "mysql_init failed\n");
        exit(1);
    }

    mysql_options(conn, MYSQL_SET_CHARSET_NAME, "utf8mb4");

    unsigned int proto = MYSQL_PROTOCOL_TCP;
    mysql_options(conn, MYSQL_OPT_PROTOCOL, &proto);

    if (!mysql_real_connect(conn, DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_PORT, NULL, 0))
    {
        fprintf(stderr, "mysql connect failed: %s\n", mysql_error(conn));
        exit(1);
    }
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

/* =========================
핵심 엔진 처리
========================= */
void engine_handle_http_event(const HttpEvent* ev)
{
    if (!ev || !ev->is_http) return;

    uuid_t uuid;
    uuid_generate(uuid);

    char request_id[37];
    uuid_unparse(uuid, request_id);

    long long log_id =
        insert_access_log(g_conn,
                          request_id,
                          ev->meta.client_ip,
                          ev->host,
                          ev->path);

    if (log_id < 0) return;

    /* policy */
    policy_decision_t d =
        match_policy(&g_cache,
                     ev->host,
                     ev->path,
                     ev->url_norm);

    if (d.matched)
    {
        if (d.action == ACT_BLOCK)
        {
            update_access_log_decision(g_conn, log_id, "BLOCK", "POLICY", "POLICY_STAGE", d.policy_id);
            http_response_inject(ev, g_conn, log_id, d.block_status_code);
            return;
        }

        if (d.action == ACT_ALLOW)
        {
            update_access_log_decision(g_conn, log_id, "ALLOW", "POLICY", "POLICY_STAGE", d.policy_id);
            return;
        }

        if (d.action == ACT_REDIRECT)
        {
            /* MVP: redirect는 REVIEW로 처리(확장 포인트) */
            update_access_log_decision(g_conn, log_id, "REVIEW", "POLICY", "POLICY_STAGE", d.policy_id);
            return;
        }

        if (d.action == ACT_REVIEW)
        {
            update_access_log_decision(g_conn, log_id, "REVIEW", "POLICY", "POLICY_STAGE", d.policy_id);
            return;
        }
    }

    /* AI */
    ai_result_t ar;
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

    /* 엔진이 ai_analysis SSOT로 기록 */
    (void)insert_ai_analysis_auto_seq(g_conn, log_id, &ar, ok ? 1 : 0, ec);

    if (!ok)
    {
        /* Fail policy: MVP는 REVIEW/FAIL_STAGE (추후 Fail-Open/Closed 옵션화) */
        update_access_log_decision(g_conn, log_id, "REVIEW", "SYSTEM", "FAIL_STAGE", 0);
        return;
    }

    action_t final = decision_manager_decide(&ar, DEFAULT_THRESHOLD);

    if (final == ACT_BLOCK)
    {
        update_access_log_decision(g_conn, log_id, "BLOCK", "AI", "AI_STAGE", 0);
        http_response_inject(ev, g_conn, log_id, 403);
    }
    else if (final == ACT_ALLOW)
    {
        update_access_log_decision(g_conn, log_id, "ALLOW", "AI", "AI_STAGE", 0);
    }
    else
    {
        update_access_log_decision(g_conn, log_id, "REVIEW", "AI", "AI_STAGE", 0);
    }
}

/* =========================
main
========================= */
int main(int argc, char** argv)
{
    const char* ifname = "enp0s3";
    if (argc >= 2) ifname = argv[1];

    printf("GateGuard Engine Start\n");

    g_conn = db_connect();

    if (load_policy_cache(&g_cache, DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME) != 0)
    {
        printf("policy load failed\n");
        /* 정책 로딩 실패해도 엔진은 계속 돌게 할지/죽일지 선택 가능 */
        /* MVP: 일단 계속 진행 */
    }

    printf("policy loaded: %zu\n", g_cache.policy_count);

    ai_client_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    snprintf(cfg.endpoint, sizeof(cfg.endpoint), "%s", API_URL);
    snprintf(cfg.token, sizeof(cfg.token), "%s", API_TOKEN);
    cfg.connect_timeout_ms = 1500;
    cfg.timeout_ms = 3000;

    if (!ai_client_init(&cfg)) {
        fprintf(stderr, "ai_client_init failed\n");
        /* MVP: 계속 실행(FAIL_STAGE로만 떨어질 수 있음) */
    }

    packet_manager_run(ifname);

    ai_client_cleanup();
    free_policy_cache(&g_cache);
    return 0;
}
