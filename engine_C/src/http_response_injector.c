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
#include <unistd.h>

#include <netinet/tcp.h>
#ifndef TH_PUSH
#define TH_PUSH TH_PSH
#endif

#define INJECT_LOG_PREFIX "[INJECT]"
#define ERROR_LOG_PREFIX  "[ERROR]"

#define GG_HTTP_RESPONSE_BUF_SIZE 4096

typedef struct {
    int initialized;
    int rst_repeat_count;           /* RST 반복 전송 횟수 */
    int enable_extra_403_retry;     /* 403 추가 재전송 활성화 */
    int extra_403_retry_count;      /* 403 추가 재전송 횟수 */
    int retry_gap_us;               /* 403/RST/FIN 반복 전송 간격(us) */
    int enable_client_side_rst;     /* client 방향 RST 사용 여부 */
    int enable_server_side_rst;     /* origin server 방향 RST 사용 여부 */
    int enable_client_fin_close;    /* client 방향 FIN 종료 사용 여부 */
} inject_runtime_cfg_t;

/*
 * 기본값:
 * - RST 5회
 * - 403 추가 재전송 활성화
 * - 403 추가 재전송 2회
 * - 반복 전송 간격 2000us
 * - client 방향 RST 비활성화
 * - origin server 방향 RST 활성화
 * - client 방향 FIN 종료 활성화
 */
static inject_runtime_cfg_t g_inject_cfg = {0, 5, 1, 2, 2000, 0, 1, 1};

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

static int env_int_or_default(const char* key, int defval, int minval, int maxval)
{
    const char* v = getenv(key);
    long parsed;
    char* endptr = NULL;

    if (!v || !v[0]) return defval;

    errno = 0;
    parsed = strtol(v, &endptr, 10);
    if (errno != 0 || endptr == v || *endptr != '\0') {
        return defval;
    }

    if ((int)parsed < minval) return minval;
    if ((int)parsed > maxval) return maxval;
    return (int)parsed;
}

static void load_inject_runtime_cfg_once(void)
{
    if (g_inject_cfg.initialized) return;

    g_inject_cfg.rst_repeat_count =
        env_int_or_default("GG_INJECT_RST_REPEAT", 5, 1, 10);

    g_inject_cfg.enable_extra_403_retry =
        env_flag_enabled("GG_INJECT_403_RETRY", 1) ? 1 : 0;

    g_inject_cfg.extra_403_retry_count =
        env_int_or_default("GG_INJECT_403_RETRY_COUNT", 2, 0, 5);

    g_inject_cfg.retry_gap_us =
        env_int_or_default("GG_INJECT_RETRY_GAP_US", 2000, 0, 50000);

    /*
     * 브라우저 렌더링 우선:
     * - client 방향 RST는 기본 비활성화
     * - origin 방향 RST는 유지
     * - client 방향 FIN 종료는 기본 활성화
     */
    g_inject_cfg.enable_client_side_rst =
        env_flag_enabled("GG_INJECT_CLIENT_RST", 0) ? 1 : 0;

    g_inject_cfg.enable_server_side_rst =
        env_flag_enabled("GG_INJECT_SERVER_RST", 1) ? 1 : 0;

    g_inject_cfg.enable_client_fin_close =
        env_flag_enabled("GG_INJECT_CLIENT_FIN", 1) ? 1 : 0;

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
     * request payload 길이가 0이면
     * ACK 계산 신뢰성이 떨어질 수 있으므로 실패 처리
     */
    if (ev->payload_len <= 0) {
        if (out_errno) *out_errno = EINVAL;
        return -1;
    }

    return 0;
}

static int resolve_block_status_code(int status_code)
{
    if (status_code > 0) return status_code;
    return GG_DEFAULT_BLOCK_STATUS_CODE;
}

static const char* resolve_reason_phrase(int status_code)
{
    switch (status_code) {
        case 403: return "Forbidden";
        case 451: return "Unavailable For Legal Reasons";
        default:  return "Forbidden";
    }
}

static int build_http_block_response(int status_code,
                                     char* out_buf,
                                     size_t out_buf_sz,
                                     size_t* out_len)
{
    static const char k_html_body_template[] =
        "<!DOCTYPE html>"
        "<html>"
        "<head>"
        "<meta charset='UTF-8'>"
        "<title>Access Blocked</title>"
        "<style>"
        "body { margin:0; padding:0; font-family:Arial, sans-serif; background:#0f172a; color:#e2e8f0; display:flex; align-items:center; justify-content:center; height:100vh; }"
        ".card { background:#1e293b; padding:40px; border-radius:12px; box-shadow:0 0 20px rgba(0,0,0,0.5); width:500px; }"
        ".title { color:#ef4444; font-size:24px; font-weight:bold; margin-bottom:20px; }"
        ".desc { margin-bottom:20px; color:#cbd5e1; }"
        ".info { font-size:14px; line-height:1.6; background:#0f172a; padding:15px; border-radius:8px; }"
        ".footer { margin-top:20px; font-size:12px; color:#64748b; text-align:center; }"
        "</style>"
        "</head>"
        "<body>"
        "<div class='card'>"
        "<div class='title'>Access Blocked</div>"
        "<div class='desc'>GateGuard has blocked this request for security reasons.</div>"
        "<div class='info'>"
        "Your request has been identified as potentially malicious.<br>"
        "Please contact your administrator if you believe this is a mistake."
        "</div>"
        "<div class='footer'>Protected by GateGuard</div>"
        "</div>"
        "</body>"
        "</html>";

    const char* reason = resolve_reason_phrase(status_code);
    int body_len;
    int total_len;

    if (!out_buf || out_buf_sz == 0 || !out_len) {
        return -1;
    }

    body_len = (int)strlen(k_html_body_template);

    total_len = snprintf(
        out_buf,
        out_buf_sz,
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: text/html; charset=UTF-8\r\n"
        "Connection: close\r\n"
        "Cache-Control: no-store, no-cache, must-revalidate\r\n"
        "Pragma: no-cache\r\n"
        "Expires: 0\r\n"
        "Content-Length: %d\r\n"
        "\r\n"
        "%s",
        status_code,
        reason,
        body_len,
        k_html_body_template
    );

    if (total_len < 0 || (size_t)total_len >= out_buf_sz) {
        return -1;
    }

    *out_len = (size_t)total_len;
    return 0;
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
                                  int retry_gap_us,
                                  int* out_errno)
{
    int i;
    int last_err = 0;
    int success = 0;

    if (repeat_count <= 0) repeat_count = 1;
    if (retry_gap_us < 0) retry_gap_us = 0;

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

        if (i + 1 < repeat_count && retry_gap_us > 0) {
            usleep((useconds_t)retry_gap_us);
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
    int err_403_retry = 0;
    int err_fin_s2c = 0;
    int err_rst_s2c = 0;
    int err_rst_c2s = 0;

    uint32_t cli_seq;
    uint32_t cli_ack;
    uint32_t req_end;
    uint32_t srv_seq_for_403;
    uint32_t srv_ack_for_403;
    uint32_t srv_seq_after_403;
    uint32_t srv_seq_after_fin;

    int rst_repeat_count;
    int enable_extra_403_retry;
    int extra_403_retry_count;
    int retry_gap_us;
    int enable_client_side_rst;
    int enable_server_side_rst;
    int enable_client_fin_close;
    int final_status_code;

    char http_response[GG_HTTP_RESPONSE_BUF_SIZE];
    size_t http_response_len = 0;

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

    if (build_http_block_response(final_status_code,
                                  http_response,
                                  sizeof(http_response),
                                  &http_response_len) != 0)
    {
        inj_errno = EINVAL;
        latency = now_ms() - t0;

        fprintf(stderr,
                "%s http response build failed: log_id=%lld status=%d\n",
                ERROR_LOG_PREFIX,
                log_id,
                final_status_code);

        update_access_log_inject(conn,
                                 log_id,
                                 attempted,
                                 send_ok,
                                 inj_errno,
                                 latency,
                                 final_status_code);
        return;
    }

    rst_repeat_count        = g_inject_cfg.rst_repeat_count;
    enable_extra_403_retry  = g_inject_cfg.enable_extra_403_retry;
    extra_403_retry_count   = g_inject_cfg.extra_403_retry_count;
    retry_gap_us            = g_inject_cfg.retry_gap_us;
    enable_client_side_rst  = g_inject_cfg.enable_client_side_rst;
    enable_server_side_rst  = g_inject_cfg.enable_server_side_rst;
    enable_client_fin_close = g_inject_cfg.enable_client_fin_close;

    /*
     * 캡처 패킷 기준:
     * client -> server HTTP request
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

    srv_seq_for_403   = cli_ack;
    srv_ack_for_403   = req_end;
    srv_seq_after_403 = srv_seq_for_403 + (uint32_t)http_response_len;
    srv_seq_after_fin = srv_seq_after_403 + 1U;

    /*
     * STEP 1) forged HTTP 403 응답 전송
     */
    if (send_forged_tcp(
            ev->meta.server_ip_nbo, ev->meta.client_ip_nbo,
            ev->meta.server_port_nbo, ev->meta.client_port_nbo,
            srv_seq_for_403,
            srv_ack_for_403,
            (uint8_t)(TH_ACK | TH_PUSH),
            (const uint8_t*)http_response,
            http_response_len,
            (uint16_t)(log_id & 0xFFFF),
            &err_403_1
        ) == 0)
    {
        send_ok = 1;
        fprintf(stderr,
                "%s block response sent: log_id=%lld status=%d seq=%u ack=%u len=%zu\n",
                INJECT_LOG_PREFIX,
                log_id,
                final_status_code,
                srv_seq_for_403,
                srv_ack_for_403,
                http_response_len);
    } else {
        fprintf(stderr,
                "%s block response send failed: log_id=%lld errno=%d\n",
                INJECT_LOG_PREFIX,
                log_id,
                err_403_1);
    }

    /*
     * STEP 1-1) 동일 seq/ack로 403 추가 재전송
     */
    if (enable_extra_403_retry && extra_403_retry_count > 0) {
        if (send_forged_tcp_repeat(
                ev->meta.server_ip_nbo, ev->meta.client_ip_nbo,
                ev->meta.server_port_nbo, ev->meta.client_port_nbo,
                srv_seq_for_403,
                srv_ack_for_403,
                (uint8_t)(TH_ACK | TH_PUSH),
                (const uint8_t*)http_response,
                http_response_len,
                (uint16_t)((log_id + 8) & 0xFFFF),
                extra_403_retry_count,
                retry_gap_us,
                &err_403_retry
            ) == 0)
        {
            send_ok = 1;
            fprintf(stderr,
                    "%s block response retry sent: log_id=%lld retry_count=%d seq=%u ack=%u\n",
                    INJECT_LOG_PREFIX,
                    log_id,
                    extra_403_retry_count,
                    srv_seq_for_403,
                    srv_ack_for_403);
        } else {
            fprintf(stderr,
                    "%s block response retry failed: log_id=%lld errno=%d retry_count=%d\n",
                    INJECT_LOG_PREFIX,
                    log_id,
                    err_403_retry,
                    extra_403_retry_count);
        }
    }

    /*
     * STEP 2) client 방향은 RST 대신 FIN,ACK로 종료
     * 브라우저가 403 body를 정상 응답으로 렌더링할 확률을 높인다.
     */
    if (enable_client_fin_close) {
        if (retry_gap_us > 0) {
            usleep((useconds_t)retry_gap_us);
        }

        if (send_forged_tcp_repeat(
                ev->meta.server_ip_nbo, ev->meta.client_ip_nbo,
                ev->meta.server_port_nbo, ev->meta.client_port_nbo,
                srv_seq_after_403,
                srv_ack_for_403,
                (uint8_t)(TH_FIN | TH_ACK),
                NULL, 0,
                (uint16_t)((log_id + 16) & 0xFFFF),
                2,
                retry_gap_us,
                &err_fin_s2c
            ) == 0)
        {
            send_ok = 1;
            fprintf(stderr,
                    "%s fin_s2c: log_id=%lld seq=%u ack=%u repeat=%d\n",
                    INJECT_LOG_PREFIX,
                    log_id,
                    srv_seq_after_403,
                    srv_ack_for_403,
                    2);
        } else {
            fprintf(stderr,
                    "%s fin_s2c failed: log_id=%lld errno=%d\n",
                    INJECT_LOG_PREFIX,
                    log_id,
                    err_fin_s2c);
        }
    }

    /*
     * STEP 3) 필요 시에만 client 방향 RST
     * 기본값은 비활성화
     */
    if (enable_client_side_rst) {
        if (send_forged_tcp_repeat(
                ev->meta.server_ip_nbo, ev->meta.client_ip_nbo,
                ev->meta.server_port_nbo, ev->meta.client_port_nbo,
                enable_client_fin_close ? srv_seq_after_fin : srv_seq_after_403,
                srv_ack_for_403,
                (uint8_t)(TH_RST | TH_ACK),
                NULL, 0,
                (uint16_t)((log_id + 24) & 0xFFFF),
                rst_repeat_count,
                retry_gap_us,
                &err_rst_s2c
            ) == 0)
        {
            send_ok = 1;
            fprintf(stderr,
                    "%s rst_s2c: log_id=%lld seq=%u ack=%u repeat=%d\n",
                    INJECT_LOG_PREFIX,
                    log_id,
                    (enable_client_fin_close ? srv_seq_after_fin : srv_seq_after_403),
                    srv_ack_for_403,
                    rst_repeat_count);
        } else {
            fprintf(stderr,
                    "%s rst_s2c failed: log_id=%lld errno=%d repeat=%d\n",
                    INJECT_LOG_PREFIX,
                    log_id,
                    err_rst_s2c,
                    rst_repeat_count);
        }
    }

    /*
     * STEP 4) origin server 방향 RST
     * 원본 서버 응답이 뒤늦게 들어오는 것을 줄이기 위해 유지
     */
    if (enable_server_side_rst) {
        if (send_forged_tcp_repeat(
                ev->meta.client_ip_nbo, ev->meta.server_ip_nbo,
                ev->meta.client_port_nbo, ev->meta.server_port_nbo,
                req_end,
                cli_ack,
                (uint8_t)(TH_RST | TH_ACK),
                NULL, 0,
                (uint16_t)((log_id + 32) & 0xFFFF),
                rst_repeat_count,
                retry_gap_us,
                &err_rst_c2s
            ) == 0)
        {
            send_ok = 1;
            fprintf(stderr,
                    "%s rst_c2s: log_id=%lld seq=%u ack=%u repeat=%d\n",
                    INJECT_LOG_PREFIX,
                    log_id,
                    req_end,
                    cli_ack,
                    rst_repeat_count);
        } else {
            fprintf(stderr,
                    "%s rst_c2s failed: log_id=%lld errno=%d repeat=%d\n",
                    INJECT_LOG_PREFIX,
                    log_id,
                    err_rst_c2s,
                    rst_repeat_count);
        }
    }

    if (!send_ok) {
        if (err_403_1) inj_errno = err_403_1;
        else if (err_403_retry) inj_errno = err_403_retry;
        else if (err_fin_s2c) inj_errno = err_fin_s2c;
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

    fprintf(stderr,
            "%s summary: log_id=%lld 403_1=%s 403_retry=%s fin_s2c=%s rst_s2c=%s rst_c2s=%s final_ok=%d errno=%d rst_repeat=%d retry_403=%d retry_gap_us=%d latency_ms=%d client_rst=%d server_rst=%d client_fin=%d\n",
            INJECT_LOG_PREFIX,
            log_id,
            (err_403_1 == 0 ? "ok" : "fail"),
            (enable_extra_403_retry ? (err_403_retry == 0 ? "ok" : "fail") : "skip"),
            (enable_client_fin_close ? (err_fin_s2c == 0 ? "ok" : "fail") : "skip"),
            (enable_client_side_rst ? (err_rst_s2c == 0 ? "ok" : "fail") : "skip"),
            (enable_server_side_rst ? (err_rst_c2s == 0 ? "ok" : "fail") : "skip"),
            send_ok,
            inj_errno,
            rst_repeat_count,
            extra_403_retry_count,
            retry_gap_us,
            latency,
            enable_client_side_rst,
            enable_server_side_rst,
            enable_client_fin_close);
}
