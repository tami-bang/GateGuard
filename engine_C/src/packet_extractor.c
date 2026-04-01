// src/packet_extractor.c
#include "packet_extractor.h"
#include "engine_struct.h"
#include "http_event_dispatch.h"

#include <pcap.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <arpa/inet.h>

#include <netinet/if_ether.h>
#include <netinet/ip.h>
#include <netinet/tcp.h>

static const unsigned char*
gg_memmem(const unsigned char* haystack,
          size_t haystack_len,
          const unsigned char* needle,
          size_t needle_len)
{
    if (!haystack || !needle || needle_len == 0) return NULL;
    if (haystack_len < needle_len) return NULL;

    size_t last = haystack_len - needle_len;
    for (size_t i = 0; i <= last; i++) {
        if (haystack[i] == needle[0] &&
            memcmp(haystack + i, needle, needle_len) == 0) {
            return haystack + i;
        }
    }
    return NULL;
}

static int starts_with_method(const unsigned char* p, size_t len)
{
    if (!p || len < 4) return 0;

    return (
        (len >= 4 && memcmp(p, "GET ", 4)  == 0) ||
        (len >= 5 && memcmp(p, "POST ", 5) == 0) ||
        (len >= 5 && memcmp(p, "HEAD ", 5) == 0) ||
        (len >= 4 && memcmp(p, "PUT ", 4)  == 0) ||
        (len >= 7 && memcmp(p, "DELETE ", 7) == 0) ||
        (len >= 8 && memcmp(p, "OPTIONS ", 8) == 0)
    );
}

static int looks_like_http_request(const unsigned char* payload, size_t len)
{
    if (!payload || len == 0) return 0;

    if (starts_with_method(payload, len)) return 1;
    if (gg_memmem(payload, len, (const unsigned char*)"Host:", 5)) return 1;
    if (gg_memmem(payload, len, (const unsigned char*)"\r\nHost:", 7)) return 1;

    return 0;
}

static const unsigned char* find_host_header(const unsigned char* payload, size_t payload_len)
{
    const unsigned char* p = gg_memmem(payload, payload_len, (const unsigned char*)"Host:", 5);
    if (p) return p;

    p = gg_memmem(payload, payload_len, (const unsigned char*)"host:", 5);
    if (p) return p;

    p = gg_memmem(payload, payload_len, (const unsigned char*)"Host :", 6);
    if (p) return p;

    p = gg_memmem(payload, payload_len, (const unsigned char*)"host :", 6);
    if (p) return p;

    return NULL;
}

static int parse_http_host_path_method(const unsigned char* payload,
                                       size_t payload_len,
                                       char* out_method,
                                       size_t method_sz,
                                       char* out_host,
                                       size_t host_sz,
                                       char* out_path,
                                       size_t path_sz)
{
    if (!payload || payload_len == 0) return 0;

    const unsigned char* line_end =
        gg_memmem(payload, payload_len, (const unsigned char*)"\r\n", 2);
    if (!line_end) return 0;

    size_t line_len = (size_t)(line_end - payload);
    if (line_len > 1023) line_len = 1023;

    char line[1024];
    memcpy(line, payload, line_len);
    line[line_len] = '\0';

    char method[16] = {0};
    char path[512] = {0};

    if (sscanf(line, "%15s %511s", method, path) != 2) {
        return 0;
    }

    snprintf(out_method, method_sz, "%s", method);
    snprintf(out_path, path_sz, "%s", path);

    const unsigned char* host_pos = find_host_header(payload, payload_len);
    if (!host_pos) {
        snprintf(out_host, host_sz, "_missing_");
        return 1;
    }

    if (memcmp(host_pos, "Host :", 6) == 0 || memcmp(host_pos, "host :", 6) == 0) {
        host_pos += 6;
    } else {
        host_pos += 5;
    }

    while ((size_t)(host_pos - payload) < payload_len &&
           (*host_pos == ' ' || *host_pos == '\t')) {
        host_pos++;
    }

    const unsigned char* host_end =
        gg_memmem(host_pos,
                  (size_t)(payload + payload_len - host_pos),
                  (const unsigned char*)"\r\n",
                  2);

    if (!host_end) {
        snprintf(out_host, host_sz, "_missing_");
        return 1;
    }

    size_t host_len = (size_t)(host_end - host_pos);
    if (host_len >= host_sz) host_len = host_sz - 1;

    memcpy(out_host, host_pos, host_len);
    out_host[host_len] = '\0';

    return 1;
}

static void on_packet(u_char* user,
                      const struct pcap_pkthdr* hdr,
                      const u_char* pkt)
{
    (void)user;

    if (!hdr || !pkt) return;
    if (hdr->caplen < sizeof(struct ether_header)) return;

    const struct ether_header* eth = (const struct ether_header*)pkt;
    if (ntohs(eth->ether_type) != ETHERTYPE_IP) return;

    size_t l2_len = sizeof(struct ether_header);
    if (hdr->caplen < l2_len + sizeof(struct ip)) return;

    const struct ip* ip = (const struct ip*)(pkt + l2_len);
    if (ip->ip_p != IPPROTO_TCP) return;

    int ip_hdr_len = ip->ip_hl * 4;
    if (ip_hdr_len < (int)sizeof(struct ip)) return;
    if (hdr->caplen < l2_len + (size_t)ip_hdr_len) return;

    int ip_total_len = ntohs(ip->ip_len);
    if (ip_total_len < ip_hdr_len + (int)sizeof(struct tcphdr)) return;

    if (hdr->caplen < l2_len + (size_t)ip_total_len) {
        /* 캡처가 잘린 경우는 forged ack 계산 신뢰성이 낮으므로 스킵 */
        return;
    }

    const struct tcphdr* tcp =
        (const struct tcphdr*)((const unsigned char*)ip + ip_hdr_len);

    int tcp_hdr_len = tcp->th_off * 4;
    if (tcp_hdr_len < (int)sizeof(struct tcphdr)) return;
    if (ip_total_len < ip_hdr_len + tcp_hdr_len) return;

    const unsigned char* payload = (const unsigned char*)tcp + tcp_hdr_len;
    int payload_len = ip_total_len - ip_hdr_len - tcp_hdr_len;
    if (payload_len <= 0) return;

    if (!looks_like_http_request(payload, (size_t)payload_len)) return;

    HttpEvent ev;
    memset(&ev, 0, sizeof(ev));

    ev.detect_ts_ms = (int64_t)hdr->ts.tv_sec * 1000 + (int64_t)hdr->ts.tv_usec / 1000;
    ev.is_http = 1;

    if (!parse_http_host_path_method(payload,
                                     (size_t)payload_len,
                                     ev.method, sizeof(ev.method),
                                     ev.host, sizeof(ev.host),
                                     ev.path, sizeof(ev.path))) {
        return;
    }

    inet_ntop(AF_INET, &ip->ip_src, ev.meta.client_ip, sizeof(ev.meta.client_ip));
    inet_ntop(AF_INET, &ip->ip_dst, ev.meta.server_ip, sizeof(ev.meta.server_ip));

    ev.meta.client_ip_nbo = ip->ip_src.s_addr;
    ev.meta.server_ip_nbo = ip->ip_dst.s_addr;
    ev.meta.client_port_nbo = tcp->th_sport;
    ev.meta.server_port_nbo = tcp->th_dport;

    ev.meta.client_port = ntohs(tcp->th_sport);
    ev.meta.server_port = ntohs(tcp->th_dport);

    /* seq/ack은 injector에서 host order로 사용 */
    ev.meta.seq = ntohl(tcp->th_seq);
    ev.meta.ack = ntohl(tcp->th_ack);
    ev.meta.tcp_flags = tcp->th_flags;

    ev.payload = payload;
    ev.payload_len = (size_t)payload_len;

    snprintf(ev.url_norm, sizeof(ev.url_norm), "%s%s", ev.host, ev.path);

    process_http_event(&ev);
}

int packet_extractor_run_pcap_loop(const char* ifname)
{
    char errbuf[PCAP_ERRBUF_SIZE];
    pcap_t* p = NULL;
    struct bpf_program fp;

    p = pcap_create(ifname, errbuf);
    if (!p) {
        fprintf(stderr, "pcap_create failed: %s\n", errbuf);
        return -1;
    }

    /* 즉시 전달 + 짧은 timeout으로 inject 지연 최소화 */
    if (pcap_set_snaplen(p, 65535) != 0) goto fail;
    if (pcap_set_promisc(p, 1) != 0) goto fail;
    if (pcap_set_timeout(p, 10) != 0) goto fail;
#ifdef PCAP_ERROR_ACTIVATED
    if (pcap_set_immediate_mode(p, 1) != 0) goto fail;
#endif

    if (pcap_activate(p) != 0) {
        fprintf(stderr, "pcap_activate failed: %s\n", pcap_geterr(p));
        pcap_close(p);
        return -1;
    }

    /*
     * 요청 방향 위주로 좁힘
     * - dst port 기준
     * - HTTP 테스트 포트 포함
     */
    if (pcap_compile(p, &fp,
                     "tcp dst port 80 or tcp dst port 8080 or tcp dst port 18080",
                     1,
                     PCAP_NETMASK_UNKNOWN) != 0) {
        fprintf(stderr, "pcap_compile failed: %s\n", pcap_geterr(p));
        pcap_close(p);
        return -1;
    }

    if (pcap_setfilter(p, &fp) != 0) {
        fprintf(stderr, "pcap_setfilter failed: %s\n", pcap_geterr(p));
        pcap_freecode(&fp);
        pcap_close(p);
        return -1;
    }

    pcap_freecode(&fp);

    fprintf(stderr, "sniffing on %s\n", ifname);
    pcap_loop(p, -1, on_packet, NULL);

    pcap_close(p);
    return 0;

fail:
    fprintf(stderr, "pcap setup failed: %s\n", pcap_geterr(p));
    if (p) pcap_close(p);
    return -1;
}
