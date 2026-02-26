// include/http_event_dispatch.h
#pragma once

#include "engine_struct.h"

#ifdef __cplusplus
extern "C" {
#endif

// packet_extractor -> engine pipeline entry
void process_http_event(const HttpEvent* ev);

#ifdef __cplusplus
}
#endif
