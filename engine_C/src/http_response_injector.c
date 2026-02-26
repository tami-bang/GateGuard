// src/http_response_injector.c
#include "http_response_injector.h"
#include "policy.h"
#include "packet_forge_util.h"
#include "raw_socket_sender.h"
#include "db_function.h"

#include <stdio.h>
#include <errno.h>
#include <string.h>
#include <sys/time.h>

#include <netinet/tcp.h>
#ifndef TH_PUSH
#define TH_PUSH TH_PSH
#endif

static int now_ms(void)
{
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (int)(tv.tv_sec * 1000 + tv.tv_usec / 1000);
}

static size_t build_http_403(char* out, size_t cap)
{
    const char* body = "Blocked by GateGuard\n";
    char buf[512];

    int body_len = (int)strlen(body);
    int n = snprintf(buf, sizeof(buf),
        "HTTP/1.1 403 Forbidden\r\n"
        "Content-Type: text/plain\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n"
        "\r\n"
        "%s",
        body_len, body
    );

    if (n <= 0) return 0;
    if ((size_t)n >= cap) return 0;

    memcpy(out, buf, (size_t)n);
    return (size_t)n;
}

void http_response_inject(const HttpEvent* ev, MYSQL* conn, long long log_id, int status_code)
{
    int t0 = now_ms();

    int attempted = 1;
    int send_ok = 0;
    int inj_errno = 0;
    int latency = 0;

    // 1) 403 payload 구성
    char payload[512];
    size_t payload_len = build_http_403(payload, sizeof(payload));
    if (payload_len == 0) {
        inj_errno = EINVAL;
        latency = now_ms() - t0;
        update_access_log_inject(conn, log_id, attempted, send_ok, inj_errno, latency,
                                 status_code > 0 ? status_code : 403);
        return;
    }

    // 2) forged packet 생성 (server -> client 방향)
    //    seq: client가 기대하는 server seq = ev.meta.ack
    //    ack: server가 확인할 client 데이터 끝 = ev.meta.seq + request_payload_len
    uint32_t seq = (uint32_t)ev->meta.ack;
    uint32_t ack = (uint32_t)(ev->meta.seq + (uint32_t)ev->payload_len);

    uint8_t pkt[1600];
    size_t pkt_len = 0;

    uint16_t ip_id = (uint16_t)(log_id & 0xFFFF);

    int rc = packet_forge_build_tcp_ipv4(
        pkt, sizeof(pkt), &pkt_len,
        ev->meta.server_ip_nbo, ev->meta.client_ip_nbo,
        ev->meta.server_port_nbo, ev->meta.client_port_nbo,
        seq, ack,
        (uint8_t)(TH_ACK | TH_PUSH),   // 최소 ACK+PSH
        (const uint8_t*)payload, payload_len,
        ip_id
    );

    if (rc != 0) {
        inj_errno = EINVAL;
        latency = now_ms() - t0;
        update_access_log_inject(conn, log_id, attempted, send_ok, inj_errno, latency,
                                 status_code > 0 ? status_code : 403);
        return;
    }

    // 3) raw send
    if (raw_send_ipv4(pkt, pkt_len, ev->meta.client_ip_nbo, &inj_errno) == 0) {
        send_ok = 1;
        inj_errno = 0;
    } else {
        send_ok = 0;
        if (inj_errno == 0) inj_errno = EIO;
    }

    latency = now_ms() - t0;

    update_access_log_inject(conn,
                             log_id,
                             attempted,
                             send_ok,
                             inj_errno,
                             latency,
                             status_code > 0 ? status_code : 403);
	printf("[inject] log_id=%lld send_ok=%d errno=%d\n", log_id, send_ok, inj_errno);
}
