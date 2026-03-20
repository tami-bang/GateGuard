#pragma once

#include "engine_struct.h"
#include <mysql/mysql.h>

#ifdef __cplusplus
extern "C" {
#endif

#define GG_DEFAULT_BLOCK_STATUS_CODE 403

/*
 * BLOCK 결정 시 HTTP 403 + 양방향 RST를 순서대로 주입하고
 * access_log.inject_* 컬럼까지 함께 갱신한다.
 */
void http_response_inject(const HttpEvent* ev, MYSQL* conn, long long log_id, int status_code);

#ifdef __cplusplus
}
#endif
