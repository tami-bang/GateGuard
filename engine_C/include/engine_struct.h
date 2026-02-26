// include/engine_struct.h
#pragma once

#include <stdint.h>
#include <stddef.h>

#ifndef IFNAMSIZ
#define IFNAMSIZ 16
#endif

// packet_extractor.c가 쓰는 meta 필드들과 일치해야 함
typedef struct {
    // 문자열 IP (inet_ntop 결과)
    char client_ip[46];
    char server_ip[46];

    // 포트/시퀀스 (packet_extractor에서 ntohs/ntohl 해서 넣고 있음)
    uint16_t client_port;
    uint16_t server_port;

    uint32_t seq;
    uint32_t ack;

    uint8_t  tcp_flags;

    // 인젝션용: 숫자 IP도 같이 보관 (network byte order)
    // (지금 extractor에서는 안 채워도 됨. 아래 2)에서 채우게 할거임)
    uint32_t client_ip_nbo;
    uint32_t server_ip_nbo;

    // 인젝션용: 포트도 nbo로 필요하면 저장(선택)
    uint16_t client_port_nbo;
    uint16_t server_port_nbo;
} tcp_meta_t;

typedef struct {
    int is_http;

    char method[16];

    char host[256];
    char path[512];

    char url_norm[768];   // host+path 정도면 이 정도면 충분

    // (선택) 탐지시간/페이로드: 있으면 인젝션 ack 계산에 도움됨
    int64_t detect_ts_ms;
    const uint8_t *payload;
    size_t payload_len;

    tcp_meta_t meta;
} HttpEvent;
