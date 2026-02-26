#ifndef DB_FUNCTION_H
#define DB_FUNCTION_H

#include <mysql/mysql.h>

#ifdef __cplusplus
extern "C" {
#endif

/* url_classification_client.h 에서 SSOT로 정의됨 (여긴 forward만) */
typedef struct ai_result_t ai_result_t;

long long insert_access_log(
    MYSQL* conn,
    const char* request_id,
    const char* client_ip,
    const char* host,
    const char* path
);

void update_access_log_decision(
    MYSQL* conn,
    long long log_id,
    const char* decision,
    const char* reason,
    const char* stage,
    long long policy_id
);

void update_access_log_inject(
    MYSQL* conn,
    long long log_id,
    int attempted,
    int send_ok,
    int inject_errno,
    int latency_ms,
    int status_code
);

int insert_ai_analysis_auto_seq(
    MYSQL* conn,
    long long log_id,
    const ai_result_t* ar,
    int ai_response,
    const char* error_code
);

#ifdef __cplusplus
}
#endif

#endif // DB_FUNCTION_H
