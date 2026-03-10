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

/* =========================
 * runtime config helpers
 * ========================= */
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

static void build_score_endpoint(char* out, size_t outsz)
{
    const char* base = get_env_str("AI_BASE_URL", "http://127.0.0.1:8000");
    if (!out || outsz == 0) return;

    size_t len = strlen(base);
    if (len > 0 && base[len - 1] == '/')
        snprintf(out, outsz, "%sv1/score", base);
    else
        snprintf(out, outsz, "%s/v1/score", base);
}

/* =========================
 * globals
 * ========================= */
static MYSQL* g_conn = NULL;
static policy_cache_t g_cache;

/* =========================
 * DB 연결
 * ========================= */
static MYSQL* db_connect(void)
{
    const char* db_host = get_env_str("DB_HOST", "127.0.0.1");
    int db_port = get_env_int("DB_PORT", 3306);
    const char* db_user = get_env_str("DB_USER", "gateguard");
    const char* db_pass = get_env_str("DB_PASSWORD", "");
    const char* db_name = get_env_str("DB_NAME", "gateguard");

    MYSQL* conn = mysql_init(NULL);
    if (!conn) {
        fprintf(stderr, "mysql_init failed\n");
        exit(1);
    }

    mysql_options(conn, MYSQL_SET_CHARSET_NAME, "utf8mb4");

    unsigned int proto = MYSQL_PROTOCOL_TCP;
    mysql_options(conn, MYSQL_OPT_PROTOCOL, &proto);

    if (!mysql_real_connect(conn, db_host, db_user, db_pass, db_name, (unsigned int)db_port, NULL, 0))
    {
        fprintf(stderr,
                "mysql connect failed: host=%s port=%d user=%s db=%s err=%s\n",
                db_host, db_port, db_user, db_name, mysql_error(conn));
        mysql_close(conn);
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
 * 핵심 엔진 처
 * ========================= */
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
   		    (void)insert_review_event_if_needed(g_conn, log_id, "POLICY_STAGE");
   		    http_response_inject(ev, g_conn, log_id, d.block_status_code);
		}

        if (d.action == ACT_ALLOW)
        {
            update_access_log_decision(g_conn, log_id, "ALLOW", "POLICY", "POLICY_STAGE", d.policy_id);
            return;
        }

        if (d.action == ACT_REDIRECT)
        {
            update_access_log_decision(g_conn, log_id, "REVIEW", "POLICY", "POLICY_STAGE", d.policy_id);
            return;
        }

        if (d.action == ACT_REVIEW)
        {
            update_access_log_decision(g_conn, log_id, "REVIEW", "POLICY", "POLICY_STAGE", d.policy_id);
            return;
        }
    }

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

    (void)insert_ai_analysis_auto_seq(g_conn, log_id, &ar, ok ? 1 : 0, ec);

    if (!ok)
    {
        update_access_log_decision(g_conn, log_id, "REVIEW", "SYSTEM", "FAIL_STAGE", 0);
        return;
    }

    double threshold = get_env_double("THRESHOLD", 0.50);
    action_t final = decision_manager_decide(&ar, threshold);

    if (final == ACT_BLOCK)
    {
        update_access_log_decision(g_conn, log_id, "BLOCK", "AI", "AI_STAGE", 0);
		(void)insert_review_event_if_needed(g_conn, log_id, "AI_STAGE");
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
 * main
 * ========================= */
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
    const char* api_token = get_env_str("API_TOKEN", "changeme-token");

    char score_endpoint[256];
    memset(score_endpoint, 0, sizeof(score_endpoint));
    build_score_endpoint(score_endpoint, sizeof(score_endpoint));

    printf("GateGuard Engine Start\n");
    printf("engine config: iface=%s db_host=%s db_port=%d db_user=%s db_name=%s ai_url=%s\n",
           ifname, db_host, db_port, db_user, db_name, score_endpoint);

    g_conn = db_connect();

    if (load_policy_cache(&g_cache, db_host, db_port, db_user, get_env_str("DB_PASSWORD", ""), db_name) != 0)
    {
        printf("policy load failed\n");
    }

    printf("policy loaded: %zu\n", g_cache.policy_count);

    ai_client_config_t cfg;
    memset(&cfg, 0, sizeof(cfg));
    snprintf(cfg.endpoint, sizeof(cfg.endpoint), "%s", score_endpoint);
    snprintf(cfg.token, sizeof(cfg.token), "%s", api_token);
    cfg.connect_timeout_ms = 1500;
    cfg.timeout_ms = 3000;

    if (!ai_client_init(&cfg)) {
        fprintf(stderr, "ai_client_init failed\n");
    }

    packet_manager_run(ifname);

    ai_client_cleanup();
    free_policy_cache(&g_cache);

    if (g_conn) {
        mysql_close(g_conn);
        g_conn = NULL;
    }

    return 0;
}
