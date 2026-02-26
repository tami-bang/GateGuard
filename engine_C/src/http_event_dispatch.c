// src/http_event_dispatch.c
#include "http_event_dispatch.h"
#include "engine_struct.h"

// main.c에 구현된 엔진 핸들러로 직접 연결
extern void engine_handle_http_event(const HttpEvent* ev);

void process_http_event(const HttpEvent* ev)
{
    engine_handle_http_event(ev);
}
