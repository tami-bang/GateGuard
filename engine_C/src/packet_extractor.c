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
    for (size_t i = 0; i <= last; i++)
    {
        if (haystack[i] == needle[0] &&
            memcmp(haystack + i, needle, needle_len) == 0)
        {
            return haystack + i;
        }
    }
    return NULL;
}

static int starts_with_method(const unsigned char* p, size_t len)
{
    if (len < 4) return 0;
    return (
        memcmp(p, "GET ", 4)  == 0 ||
        memcmp(p, "POST", 4)  == 0 ||
        memcmp(p, "HEAD", 4)  == 0 ||
        memcmp(p, "PUT ", 4)  == 0 ||
        memcmp(p, "DELE", 4)  == 0 ||
        memcmp(p, "OPTI", 4)  == 0
    );
}

static int looks_like_http_request(const unsigned char* payload, size_t len)
{
    // MVP: payload 시작이 request line인 경우만 잡는다.
    // (TCP 세그먼트 분할/재전송으로 놓칠 수 있으므로, host missing 처리로 DB insert는 유지)
    return starts_with_method(payload, len);
}

static const unsigned char* find_host_header(const unsigned char* payload, size_t payload_len)
{
    // 간단하게 Host:, host: 둘 다 허용
    const unsigned char* p = gg_memmem(payload, payload_len, (const unsigned char*)"Host:", 5);
    if (p) return p;

    p = gg_memmem(payload, payload_len, (const unsigned char*)"host:", 5);
    if (p) return p;

    // "Host :" 같은 변형도 일부 허용
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
    char path[512]  = {0};

    if (sscanf(line, "%15s %511s", method, path) != 2)
        return 0;

    snprintf(out_method, method_sz, "%s", method);
    snprintf(out_path,   path_sz,   "%s", path);

    // Host는 없을 수도 있으므로, 없으면 _missing_으로 채워서 이벤트를 계속 흘린다.
    const unsigned char* host_pos = find_host_header(payload, payload_len);
    if (!host_pos) {
        snprintf(out_host, host_sz, "_missing_");
        return 1;
    }

    // Host: 또는 Host : 처리
    if (memcmp(host_pos, "Host :", 6) == 0 || memcmp(host_pos, "host :", 6) == 0) {
        host_pos += 6;
    } else {
        host_pos += 5;
    }

    while (*host_pos == ' ' || *host_pos == '\t') host_pos++;

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

    if (hdr->caplen < sizeof(struct ether_header)) return;

    const struct ether_header* eth = (const struct ether_header*)pkt;
    if (ntohs(eth->ether_type) != ETHERTYPE_IP) return;

    const struct ip* ip = (const struct ip*)(pkt + sizeof(struct ether_header));
    if (ip->ip_p != IPPROTO_TCP) return;

    int ip_hdr_len = ip->ip_hl * 4;

    const struct tcphdr* tcp =
        (const struct tcphdr*)((const unsigned char*)ip + ip_hdr_len);

    int tcp_hdr_len = tcp->th_off * 4;

    const unsigned char* payload = (const unsigned char*)tcp + tcp_hdr_len;
    int payload_len = (int)(hdr->caplen - (payload - pkt));
    if (payload_len <= 0) return;

    if (!looks_like_http_request(payload, (size_t)payload_len)) return;

    HttpEvent ev;
    memset(&ev, 0, sizeof(ev));

    ev.is_http = 1;

    if (!parse_http_host_path_method(payload,
                                     (size_t)payload_len,
                                     ev.method, sizeof(ev.method),
                                     ev.host,   sizeof(ev.host),
                                     ev.path,   sizeof(ev.path)))
    {
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

    pcap_t* p = pcap_open_live(ifname, 65535, 1, 1000, errbuf);
    if (!p)
    {
        printf("pcap_open_live failed: %s\n", errbuf);
        return -1;
    }

    struct bpf_program fp;
    if (pcap_compile(p, &fp, "tcp and (port 80 or port 8080)", 1, PCAP_NETMASK_UNKNOWN) != 0)
    {
        printf("pcap_compile failed\n");
        pcap_close(p);
        return -1;
    }

    if (pcap_setfilter(p, &fp) != 0)
    {
        printf("pcap_setfilter failed\n");
        pcap_close(p);
        return -1;
    }

    printf("sniffing on %s\n", ifname);
    pcap_loop(p, -1, on_packet, NULL);

    pcap_close(p);
    return 0;
}
