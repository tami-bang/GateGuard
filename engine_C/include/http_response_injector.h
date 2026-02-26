// include/http_response_injector.h
#pragma once

#include "engine_struct.h"
#include <mysql/mysql.h>

#ifdef __cplusplus
extern "C" {
#endif

// BLOCK 시 1회 주입 시도 + DB inject_* 업데이트
void http_response_inject(const HttpEvent* ev, MYSQL* conn, long long log_id, int status_code);

#ifdef __cplusplus
}
#endif
