#ifndef DB_FUNCTION_H
#define DB_FUNCTION_H

#include <mysql/mysql.h>

#ifdef __cplusplus
extern "C" {
#endif

// AI 분석 결과 구조체 전방 선언
typedef struct ai_result_t ai_result_t;

/*
 * access_log 테이블에 새로운 요청 로그를 저장
 * 요청이 감지될 때 최초로 호출됨
 * 반환값: 생성된 log_id (auto increment)
 */
long long insert_access_log(
    MYSQL* conn,
    const char* request_id,
    const char* client_ip,
    int client_port,
    const char* server_ip,
    int server_port,
    const char* host,
    const char* path,
    const char* method,
    const char* url_norm
);

/*
 * access_log 의 탐지 결과(decision) 업데이트
 * 차단 여부, 사유, 탐지 단계 및 정책 정보 기록
 */
void update_access_log_decision(
    MYSQL* conn,
    long long log_id,
    const char* decision,
    const char* reason,
    const char* stage,
    long long policy_id,
    int engine_latency_ms
);

/*
 * HTTP Injection 처리 결과 업데이트
 * 차단 응답 전송 시도 여부 및 성공 여부 기록
 */
void update_access_log_inject(
    MYSQL* conn,
    long long log_id,
    int attempted,
    int send_ok,
    int inject_errno,
    int latency_ms,
    int status_code
);

/*
 * AI 분석 결과를 ai_analysis 테이블에 저장
 * 동일 로그에 대해 여러 분석이 있을 경우 자동 순번 부여
 */
int insert_ai_analysis_auto_seq(
    MYSQL* conn,
    long long log_id,
    const ai_result_t* ar,
    int ai_response,
    const char* error_code
);

/*
 * 검토가 필요한 경우 review_event 생성
 * decision_stage 기준으로 자동 판단
 */
int insert_review_event_if_needed(
    MYSQL* conn,
    long long log_id,
    const char* decision_stage
);

#ifdef __cplusplus
}
#endif

#endif // DB_FUNCTION_H
