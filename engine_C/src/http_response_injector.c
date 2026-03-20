#include "http_response_injector.h"
#include "policy.h"
#include "packet_forge_util.h"
#include "raw_socket_sender.h"
#include "db_function.h"

#include <stdio.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>
#include <strings.h>
#include <sys/time.h>

#include <netinet/tcp.h>
#ifndef TH_PUSH
#define TH_PUSH TH_PSH
#endif

#define INJECT_LOG_PREFIX "[INJECT]"
#define ERROR_LOG_PREFIX  "[ERROR]"

typedef struct {
    int initialized;
    int rst_repeat_count;
    int enable_extra_403_retry;
} inject_runtime_cfg_t;

static inject_runtime_cfg_t g_inject_cfg = {0, 1, 0};

static int now_ms(void)
{
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (int)(tv.tv_sec * 1000 + tv.tv_usec / 1000);
}

static int env_flag_enabled(const char* key, int defval)
{
    const char* v = getenv(key);
    if (!v || !v[0]) return defval;

    if (strcmp(v, "1") == 0) return 1;
    if (strcasecmp(v, "true") == 0) return 1;
    if (strcasecmp(v, "yes") == 0) return 1;
    if (strcasecmp(v, "on") == 0) return 1;

    if (strcmp(v, "0") == 0) return 0;
    if (strcasecmp(v, "false") == 0) return 0;
    if (strcasecmp(v, "no") == 0) return 0;
    if (strcasecmp(v, "off") == 0) return 0;

    return defval;
}

static void load_inject_runtime_cfg_once(void)
{
    if (g_inject_cfg.initialized) return;

    /*
     * GG_INJECT_RST_REPEAT=1  -> RST를 2회 전송
     * 기본값                 -> 1회 전송
     */
    g_inject_cfg.rst_repeat_count = env_flag_enabled("GG_INJECT_RST_REPEAT", 0) ? 2 : 1;

    /*
     * GG_INJECT_403_RETRY=1  -> 403을 1회 추가 재전송
     * 기본값                -> 비활성화
     */
    g_inject_cfg.enable_extra_403_retry = env_flag_enabled("GG_INJECT_403_RETRY", 0) ? 1 : 0;

    g_inject_cfg.initialized = 1;
}

static int validate_event_for_injection(const HttpEvent* ev, int* out_errno)
{
    if (!ev) {
        if (out_errno) *out_errno = EINVAL;
        return -1;
    }

    if (ev->meta.client_ip_nbo == 0 || ev->meta.server_ip_nbo == 0) {
        if (out_errno) *out_errno = EINVAL;
        return -1;
    }

    if (ev->meta.client_port_nbo == 0 || ev->meta.server_port_nbo == 0) {
        if (out_errno) *out_errno = EINVAL;
        return -1;
    }

    /*
     * request payload 길이가 0이면 ACK 계산 신뢰성이 떨어질 수 있으므로
     * 방어적으로 injection 실패 처리한다.
     */
    if (ev->payload_len <= 0) {
        if (out_errno) *out_errno = EINVAL;
        return -1;
    }

    return 0;
}

/*
 * 403 payload는 동적 조립 대신 고정 바이트열 사용
 * - hot path snprintf 제거
 * - body 포함 최소 길이 유지
 */
static const char k_http_403_payload[] =
    "HTTP/1.1 403 Forbidden\r\n"
    "Content-Length: 21\r\n"
    "Content-Type: text/plain\r\n"
    "Connection: close\r\n"
    "Cache-Control: no-store\r\n"
    "\r\n"
    "Blocked by GateGuard\n";

static const size_t k_http_403_payload_len = sizeof(k_http_403_payload) - 1;

static int resolve_block_status_code(int status_code)
{
    if (status_code > 0) return status_code;
    return GG_DEFAULT_BLOCK_STATUS_CODE;
}

static int send_forged_tcp(uint32_t src_ip_nbo,
                           uint32_t dst_ip_nbo,
                           uint16_t src_port_nbo,
                           uint16_t dst_port_nbo,
                           uint32_t seq,
                           uint32_t ack,
                           uint8_t tcp_flags,
                           const uint8_t* payload,
                           size_t payload_len,
                           uint16_t ip_id,
                           int* out_errno)
{
    uint8_t pkt[1600];
    size_t pkt_len = 0;

    if (out_errno) *out_errno = 0;

    if (packet_forge_build_tcp_ipv4(
            pkt, sizeof(pkt), &pkt_len,
            src_ip_nbo, dst_ip_nbo,
            src_port_nbo, dst_port_nbo,
            seq, ack,
            tcp_flags,
            payload, payload_len,
            ip_id
        ) != 0)
    {
        if (out_errno) *out_errno = EINVAL;
        return -1;
    }

    if (raw_send_ipv4(pkt, pkt_len, dst_ip_nbo, out_errno) != 0) {
        if (out_errno && *out_errno == 0) *out_errno = EIO;
        return -1;
    }

    return 0;
}

static int send_forged_tcp_repeat(uint32_t src_ip_nbo,
                                  uint32_t dst_ip_nbo,
                                  uint16_t src_port_nbo,
                                  uint16_t dst_port_nbo,
                                  uint32_t seq,
                                  uint32_t ack,
                                  uint8_t tcp_flags,
                                  const uint8_t* payload,
                                  size_t payload_len,
                                  uint16_t base_ip_id,
                                  int repeat_count,
                                  int* out_errno)
{
    int i;
    int last_err = 0;
    int success = 0;

    if (repeat_count <= 0) repeat_count = 1;

    for (i = 0; i < repeat_count; i++) {
        int step_errno = 0;
        uint16_t ip_id = (uint16_t)(base_ip_id + (uint16_t)i);

        if (send_forged_tcp(
                src_ip_nbo, dst_ip_nbo,
                src_port_nbo, dst_port_nbo,
                seq, ack,
                tcp_flags,
                payload, payload_len,
                ip_id,
                &step_errno
            ) == 0)
        {
            success = 1;
        } else {
            last_err = step_errno;
        }
    }

    if (success) {
        if (out_errno) *out_errno = 0;
        return 0;
    }

    if (out_errno) *out_errno = (last_err != 0 ? last_err : EIO);
    return -1;
}

void http_response_inject(const HttpEvent* ev, MYSQL* conn, long long log_id, int status_code)
{
    int t0 = now_ms();

    int attempted = 1;
    int send_ok = 0;
    int inj_errno = 0;
    int latency = 0;

    int err_403_1 = 0;
    int err_403_2 = 0;
    int err_rst_s2c = 0;
    int err_rst_c2s = 0;

    uint32_t cli_seq;
    uint32_t cli_ack;
    uint32_t req_end;
    uint32_t srv_seq_for_403;
    uint32_t srv_ack_for_403;
    uint32_t srv_seq_after_403;
    int rst_repeat_count;
    int enable_extra_403_retry;
    int final_status_code;

    load_inject_runtime_cfg_once();
    final_status_code = resolve_block_status_code(status_code);

    if (validate_event_for_injection(ev, &inj_errno) != 0) {
        latency = now_ms() - t0;

        fprintf(stderr,
                "%s injection validation failed: log_id=%lld errno=%d\n",
                ERROR_LOG_PREFIX,
                log_id,
                inj_errno);

        update_access_log_inject(conn,
                                 log_id,
                                 attempted,
                                 send_ok,
                                 inj_errno,
                                 latency,
                                 final_status_code);
        return;
    }

    rst_repeat_count = g_inject_cfg.rst_repeat_count;
    enable_extra_403_retry = g_inject_cfg.enable_extra_403_retry;

    /*
     * Injection sequence
     *
     * 1) forged server -> client HTTP 403
     *    - 사용자 브라우저에 차단 응답을 먼저 보이게 시도
     *
     * 2) forged server -> client RST
     *    - 403 뒤 서버 방향 세션을 빠르게 종료
     *
     * 3) forged client -> server RST
     *    - 대상 서버 측 세션도 정리
     *
     * 즉, 프로젝트 의도상 "403 선전송"이 우선이고
     * 그 다음 양방향 RST로 연결을 닫는다.
     */

    /*
     * 캡처 패킷 기준:
     *   client -> server HTTP request
     *
     * client seq = ev->meta.seq
     * client ack = ev->meta.ack
     * request end = client seq + request payload len
     *
     * forged server -> client 403:
     *   seq = client ack
     *   ack = request end
     */
    cli_seq = (uint32_t)ev->meta.seq;
    cli_ack = (uint32_t)ev->meta.ack;
    req_end = (uint32_t)(cli_seq + (uint32_t)ev->payload_len);

    srv_seq_for_403 = cli_ack;
    srv_ack_for_403 = req_end;
    srv_seq_after_403 = srv_seq_for_403 + (uint32_t)k_http_403_payload_len;

    /*
     * STEP 1) forged HTTP 403
     */
    if (send_forged_tcp(
            ev->meta.server_ip_nbo, ev->meta.client_ip_nbo,
            ev->meta.server_port_nbo, ev->meta.client_port_nbo,
            srv_seq_for_403,
            srv_ack_for_403,
            (uint8_t)(TH_ACK | TH_PUSH),
            (const uint8_t*)k_http_403_payload,
            k_http_403_payload_len,
            (uint16_t)(log_id & 0xFFFF),
            &err_403_1
        ) == 0)
    {
        send_ok = 1;
        printf("%s 403 sent: log_id=%lld status=%d seq=%u ack=%u\n",
               INJECT_LOG_PREFIX,
               log_id,
               final_status_code,
               srv_seq_for_403,
               srv_ack_for_403);
    } else {
        printf("%s 403 sent failed: log_id=%lld errno=%d\n",
               INJECT_LOG_PREFIX,
               log_id,
               err_403_1);
    }

    /*
     * STEP 1-1) optional extra 403 retry
     * 같은 seq/ack로 한 번 더 전송해서 표시 성공률을 약간 높인다.
     */
    if (enable_extra_403_retry) {
        if (send_forged_tcp(
                ev->meta.server_ip_nbo, ev->meta.client_ip_nbo,
                ev->meta.server_port_nbo, ev->meta.client_port_nbo,
                srv_seq_for_403,
                srv_ack_for_403,
                (uint8_t)(TH_ACK | TH_PUSH),
                (const uint8_t*)k_http_403_payload,
                k_http_403_payload_len,
                (uint16_t)((log_id + 8) & 0xFFFF),
                &err_403_2
            ) == 0)
        {
            send_ok = 1;
            printf("%s 403 retry sent: log_id=%lld status=%d seq=%u ack=%u\n",
                   INJECT_LOG_PREFIX,
                   log_id,
                   final_status_code,
                   srv_seq_for_403,
                   srv_ack_for_403);
        } else {
            printf("%s 403 retry failed: log_id=%lld errno=%d\n",
                   INJECT_LOG_PREFIX,
                   log_id,
                   err_403_2);
        }
    }

    /*
     * STEP 2) server -> client RST
     * forged 403 이후 브라우저 방향 세션을 종료
     */
    if (send_forged_tcp_repeat(
            ev->meta.server_ip_nbo, ev->meta.client_ip_nbo,
            ev->meta.server_port_nbo, ev->meta.client_port_nbo,
            srv_seq_after_403,
            srv_ack_for_403,
            (uint8_t)(TH_RST | TH_ACK),
            NULL, 0,
            (uint16_t)((log_id + 16) & 0xFFFF),
            rst_repeat_count,
            &err_rst_s2c
        ) == 0)
    {
        send_ok = 1;
        printf("%s rst_s2c: log_id=%lld seq=%u ack=%u repeat=%d\n",
               INJECT_LOG_PREFIX,
               log_id,
               srv_seq_after_403,
               srv_ack_for_403,
               rst_repeat_count);
    } else {
        printf("%s rst_s2c failed: log_id=%lld errno=%d repeat=%d\n",
               INJECT_LOG_PREFIX,
               log_id,
               err_rst_s2c,
               rst_repeat_count);
    }

    /*
     * STEP 3) client -> server RST
     * 대상 서버 측 세션도 빠르게 정리
     */
    if (send_forged_tcp_repeat(
            ev->meta.client_ip_nbo, ev->meta.server_ip_nbo,
            ev->meta.client_port_nbo, ev->meta.server_port_nbo,
            req_end,
            cli_ack,
            (uint8_t)(TH_RST | TH_ACK),
            NULL, 0,
            (uint16_t)((log_id + 32) & 0xFFFF),
            rst_repeat_count,
            &err_rst_c2s
        ) == 0)
    {
        send_ok = 1;
        printf("%s rst_c2s: log_id=%lld seq=%u ack=%u repeat=%d\n",
               INJECT_LOG_PREFIX,
               log_id,
               req_end,
               cli_ack,
               rst_repeat_count);
    } else {
        printf("%s rst_c2s failed: log_id=%lld errno=%d repeat=%d\n",
               INJECT_LOG_PREFIX,
               log_id,
               err_rst_c2s,
               rst_repeat_count);
    }

    if (!send_ok) {
        if (err_403_1) inj_errno = err_403_1;
        else if (err_403_2) inj_errno = err_403_2;
        else if (err_rst_s2c) inj_errno = err_rst_s2c;
        else if (err_rst_c2s) inj_errno = err_rst_c2s;
        else inj_errno = EIO;
    } else {
        inj_errno = 0;
    }

    latency = now_ms() - t0;

    update_access_log_inject(conn,
                             log_id,
                             attempted,
                             send_ok,
                             inj_errno,
                             latency,
                             final_status_code);

    printf("%s summary: log_id=%lld 403_1=%s 403_2=%s rst_s2c=%s rst_c2s=%s final_ok=%d errno=%d rst_repeat=%d latency_ms=%d\n",
           INJECT_LOG_PREFIX,
           log_id,
           (err_403_1 == 0 ? "ok" : "fail"),
           (enable_extra_403_retry ? (err_403_2 == 0 ? "ok" : "fail") : "skip"),
           (err_rst_s2c == 0 ? "ok" : "fail"),
           (err_rst_c2s == 0 ? "ok" : "fail"),
           send_ok,
           inj_errno,
           rst_repeat_count,
           latency);
}
