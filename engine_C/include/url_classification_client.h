// include/url_classification_client.h
#pragma once

#include <stdint.h>
#include "engine_struct.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    AI_OK = 0,
    AI_ERR_CURL = 1,
    AI_ERR_HTTP = 2,
    AI_ERR_TIMEOUT = 3,
    AI_ERR_PARSE = 4,
    AI_ERR_EMPTY = 5
} ai_error_t;

/*
 * 중요:
 * - policy.h에서 `typedef struct ai_result_t ai_result_t;` forward 선언을 쓰려면
 *   여기서 struct 태그를 반드시 붙여야 함.
 */
typedef struct ai_result_t {
    int ok;                 // 1이면 성공
    double score;           // 0~1
    char label[32];         // "benign" / "malicious"
    char model_version[64]; // "urlclf-xxx"
    int http_status;        // HTTP status code
    ai_error_t error_code;  // 위 enum
    int64_t latency_ms;     // 호출 지연(ms)
    char raw[512];          // (옵션) 에러 시 raw snippet
} ai_result_t;

typedef struct {
    char endpoint[256];     // 예: http://127.0.0.1:8000/v1/score
    int timeout_ms;         // total timeout
    int connect_timeout_ms; // connect timeout
    char token[128];        // optional
} ai_client_config_t;

// config는 main/config에서 1회 세팅하고 계속 재사용
int ai_client_init(const ai_client_config_t* cfg);
void ai_client_cleanup(void);

/*
 * 신규 권장 API: request_id를 별도로 넘김 (HttpEvent에 request_id가 없기 때문)
 * - request_id == NULL 이면 payload에 request_id를 넣지 않고 호출
 * - out에 에러코드/latency/http_status 등이 기록됨
 */
int ai_classify_url_ex(const HttpEvent* ev, const char* request_id, ai_result_t* out);

/*
 * 기존 호환 API: 기존 호출부 깨지지 않게 유지
 * - 내부적으로 ai_classify_url_ex(ev, NULL, out) 호출
 */
int ai_classify_url(const HttpEvent* ev, ai_result_t* out);

#ifdef __cplusplus
}
#endif
