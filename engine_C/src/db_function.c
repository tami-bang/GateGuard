#include "db_function.h"
#include "url_classification_client.h"

#include <string.h>

/*
 * MariaDB 10.3 / MySQL 헤더 조합에서 my_bool 유무가 갈릴 수 있음.
 * MYSQL_BIND.is_null 은 my_bool* 기대.
 */
#ifndef my_bool
typedef _Bool my_bool;
#endif

static int stmt_prepare(MYSQL_STMT* stmt, const char* sql)
{
    if (!stmt || !sql) return -1;
    if (mysql_stmt_prepare(stmt, sql, (unsigned long)strlen(sql)) != 0) return -1;
    return 0;
}

long long insert_access_log(
    MYSQL* conn,
    const char* request_id,
    const char* client_ip,
    const char* host,
    const char* path)
{
    if (!conn || !request_id || !client_ip || !host) return -1;

    const char* sql =
        "INSERT INTO access_log "
        "(request_id, detect_timestamp, client_ip, host, path, decision, reason, decision_stage) "
        "VALUES (?, NOW(), ?, ?, ?, 'ERROR', 'SYSTEM', 'FAIL_STAGE')";

    MYSQL_STMT* stmt = mysql_stmt_init(conn);
    if (!stmt) return -1;
    if (stmt_prepare(stmt, sql) != 0) { mysql_stmt_close(stmt); return -1; }

    MYSQL_BIND b[4];
    memset(b, 0, sizeof(b));

    const char* p = (path && path[0]) ? path : "/";

    unsigned long l0 = (unsigned long)strlen(request_id);
    unsigned long l1 = (unsigned long)strlen(client_ip);
    unsigned long l2 = (unsigned long)strlen(host);
    unsigned long l3 = (unsigned long)strlen(p);

    b[0].buffer_type = MYSQL_TYPE_STRING;
    b[0].buffer = (char*)request_id;
    b[0].buffer_length = l0;
    b[0].length = &l0;

    b[1].buffer_type = MYSQL_TYPE_STRING;
    b[1].buffer = (char*)client_ip;
    b[1].buffer_length = l1;
    b[1].length = &l1;

    b[2].buffer_type = MYSQL_TYPE_STRING;
    b[2].buffer = (char*)host;
    b[2].buffer_length = l2;
    b[2].length = &l2;

    b[3].buffer_type = MYSQL_TYPE_STRING;
    b[3].buffer = (char*)p;
    b[3].buffer_length = l3;
    b[3].length = &l3;

    if (mysql_stmt_bind_param(stmt, b) != 0) { mysql_stmt_close(stmt); return -1; }
    if (mysql_stmt_execute(stmt) != 0) { mysql_stmt_close(stmt); return -1; }

    long long log_id = (long long)mysql_insert_id(conn);
    mysql_stmt_close(stmt);
    return log_id;
}

void update_access_log_decision(
    MYSQL* conn,
    long long log_id,
    const char* decision,
    const char* reason,
    const char* stage,
    long long policy_id)
{
    if (!conn || log_id <= 0 || !decision || !reason || !stage) return;

    const char* sql =
        "UPDATE access_log "
        "SET decision=?, reason=?, decision_stage=?, policy_id=? "
        "WHERE log_id=?";

    MYSQL_STMT* stmt = mysql_stmt_init(conn);
    if (!stmt) return;
    if (stmt_prepare(stmt, sql) != 0) { mysql_stmt_close(stmt); return; }

    MYSQL_BIND b[5];
    memset(b, 0, sizeof(b));

    unsigned long l0 = (unsigned long)strlen(decision);
    unsigned long l1 = (unsigned long)strlen(reason);
    unsigned long l2 = (unsigned long)strlen(stage);

    my_bool is_null_policy = (policy_id == 0) ? 1 : 0;

    b[0].buffer_type = MYSQL_TYPE_STRING;
    b[0].buffer = (char*)decision;
    b[0].buffer_length = l0;
    b[0].length = &l0;

    b[1].buffer_type = MYSQL_TYPE_STRING;
    b[1].buffer = (char*)reason;
    b[1].buffer_length = l1;
    b[1].length = &l1;

    b[2].buffer_type = MYSQL_TYPE_STRING;
    b[2].buffer = (char*)stage;
    b[2].buffer_length = l2;
    b[2].length = &l2;

    b[3].buffer_type = MYSQL_TYPE_LONGLONG;
    b[3].buffer = &policy_id;
    b[3].is_null = &is_null_policy;

    b[4].buffer_type = MYSQL_TYPE_LONGLONG;
    b[4].buffer = &log_id;

    if (mysql_stmt_bind_param(stmt, b) != 0) { mysql_stmt_close(stmt); return; }
    (void)mysql_stmt_execute(stmt);
    mysql_stmt_close(stmt);
}

void update_access_log_inject(
    MYSQL* conn,
    long long log_id,
    int attempted,
    int send_ok,
    int inject_errno,
    int latency_ms,
    int status_code)
{
    if (!conn || log_id <= 0) return;

    const char* sql =
        "UPDATE access_log SET "
        "inject_attempted=?, inject_send=?, inject_errno=?, "
        "inject_latency_ms=?, inject_status_code=? "
        "WHERE log_id=?";

    MYSQL_STMT* stmt = mysql_stmt_init(conn);
    if (!stmt) return;
    if (stmt_prepare(stmt, sql) != 0) { mysql_stmt_close(stmt); return; }

    MYSQL_BIND b[6];
    memset(b, 0, sizeof(b));

    my_bool is_null_errno = (send_ok == 1) ? 1 : 0;

    b[0].buffer_type = MYSQL_TYPE_TINY;
    b[0].buffer = &attempted;

    b[1].buffer_type = MYSQL_TYPE_TINY;
    b[1].buffer = &send_ok;

    b[2].buffer_type = MYSQL_TYPE_LONG;
    b[2].buffer = &inject_errno;
    b[2].is_null = &is_null_errno;

    b[3].buffer_type = MYSQL_TYPE_LONG;
    b[3].buffer = &latency_ms;

    b[4].buffer_type = MYSQL_TYPE_LONG;
    b[4].buffer = &status_code;

    b[5].buffer_type = MYSQL_TYPE_LONGLONG;
    b[5].buffer = &log_id;

    if (mysql_stmt_bind_param(stmt, b) != 0) { mysql_stmt_close(stmt); return; }
    (void)mysql_stmt_execute(stmt);
    mysql_stmt_close(stmt);
}

static int get_next_analysis_seq(MYSQL* conn, long long log_id, int* out_seq)
{
    if (!conn || log_id <= 0 || !out_seq) return -1;

    const char* sql =
        "SELECT COALESCE(MAX(analysis_seq), -1) + 1 "
        "FROM ai_analysis WHERE log_id=?";

    MYSQL_STMT* stmt = mysql_stmt_init(conn);
    if (!stmt) return -1;
    if (stmt_prepare(stmt, sql) != 0) { mysql_stmt_close(stmt); return -1; }

    MYSQL_BIND inb[1];
    memset(inb, 0, sizeof(inb));
    inb[0].buffer_type = MYSQL_TYPE_LONGLONG;
    inb[0].buffer = &log_id;

    if (mysql_stmt_bind_param(stmt, inb) != 0) { mysql_stmt_close(stmt); return -1; }
    if (mysql_stmt_execute(stmt) != 0) { mysql_stmt_close(stmt); return -1; }

    int seq = 0;
    MYSQL_BIND outb[1];
    memset(outb, 0, sizeof(outb));
    outb[0].buffer_type = MYSQL_TYPE_LONG;
    outb[0].buffer = &seq;

    if (mysql_stmt_bind_result(stmt, outb) != 0) { mysql_stmt_close(stmt); return -1; }
    if (mysql_stmt_fetch(stmt) != 0) { mysql_stmt_close(stmt); return -1; }

    mysql_stmt_close(stmt);
    *out_seq = seq;
    return 0;
}

int insert_ai_analysis_auto_seq(
    MYSQL* conn,
    long long log_id,
    const ai_result_t* ar,
    int ai_response,
    const char* error_code)
{
    if (!conn || log_id <= 0) return -1;

    int seq = 0;
    if (get_next_analysis_seq(conn, log_id, &seq) != 0) return -1;

    const char* sql =
        "INSERT INTO ai_analysis "
        "(log_id, analyzed_at, score, label, ai_response, latency_ms, model_version, error_code, analysis_seq) "
        "VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?)";

    MYSQL_STMT* stmt = mysql_stmt_init(conn);
    if (!stmt) return -1;
    if (stmt_prepare(stmt, sql) != 0) { mysql_stmt_close(stmt); return -1; }

    double score = (ar ? ar->score : 0.0);
    int latency = (ar ? (int)ar->latency_ms : 0);

    const char* label = (ar && ar->label[0]) ? ar->label : NULL;
    const char* mv = (ar && ar->model_version[0]) ? ar->model_version : "unknown";
    const char* ec = error_code; // NULL 허용

    my_bool is_null_label = (label == NULL) ? 1 : 0;
    my_bool is_null_ec = (ec == NULL) ? 1 : 0;

    unsigned long l_label = label ? (unsigned long)strlen(label) : 0;
    unsigned long l_mv = (unsigned long)strlen(mv);
    unsigned long l_ec = ec ? (unsigned long)strlen(ec) : 0;

    MYSQL_BIND b[8];
    memset(b, 0, sizeof(b));

    b[0].buffer_type = MYSQL_TYPE_LONGLONG;
    b[0].buffer = &log_id;

    b[1].buffer_type = MYSQL_TYPE_DOUBLE;
    b[1].buffer = &score;

    b[2].buffer_type = MYSQL_TYPE_STRING;
    b[2].buffer = (char*)label;
    b[2].buffer_length = l_label;
    b[2].length = &l_label;
    b[2].is_null = &is_null_label;

    b[3].buffer_type = MYSQL_TYPE_TINY;
    b[3].buffer = &ai_response;

    b[4].buffer_type = MYSQL_TYPE_LONG;
    b[4].buffer = &latency;

    b[5].buffer_type = MYSQL_TYPE_STRING;
    b[5].buffer = (char*)mv;
    b[5].buffer_length = l_mv;
    b[5].length = &l_mv;

    b[6].buffer_type = MYSQL_TYPE_STRING;
    b[6].buffer = (char*)ec;
    b[6].buffer_length = l_ec;
    b[6].length = &l_ec;
    b[6].is_null = &is_null_ec;

    b[7].buffer_type = MYSQL_TYPE_LONG;
    b[7].buffer = &seq;

    if (mysql_stmt_bind_param(stmt, b) != 0) { mysql_stmt_close(stmt); return -1; }
    if (mysql_stmt_execute(stmt) != 0) { mysql_stmt_close(stmt); return -1; }

    mysql_stmt_close(stmt);
    return 0;
}
