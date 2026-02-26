// src/packet_forge_util.c
#include "packet_forge_util.h"

#include <string.h>
#include <netinet/ip.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>

typedef struct {
    uint32_t src;
    uint32_t dst;
    uint8_t  zero;
    uint8_t  proto;
    uint16_t tcp_len;
} pseudo_hdr_t;

uint16_t packet_forge_checksum16(const void* data, size_t len)
{
    const uint8_t* p = (const uint8_t*)data;
    uint32_t sum = 0;

    while (len > 1) {
        uint16_t w = ((uint16_t)p[0] << 8) | p[1];
        sum += w;
        p += 2;
        len -= 2;
    }

    if (len == 1) {
        uint16_t w = ((uint16_t)p[0] << 8);
        sum += w;
    }

    while (sum >> 16)
        sum = (sum & 0xFFFF) + (sum >> 16);

    return (uint16_t)(~sum);
}

static uint16_t checksum_tcp_ipv4(uint32_t src_nbo,
                                  uint32_t dst_nbo,
                                  const struct tcphdr* tcp,
                                  const uint8_t* payload,
                                  size_t payload_len)
{
    pseudo_hdr_t ph;
    ph.src = src_nbo;
    ph.dst = dst_nbo;
    ph.zero = 0;
    ph.proto = IPPROTO_TCP;
    uint16_t tcp_len = (uint16_t)(sizeof(struct tcphdr) + payload_len);
    ph.tcp_len = htons(tcp_len);

    uint8_t buf[2048];
    size_t off = 0;

    if (sizeof(ph) + sizeof(struct tcphdr) + payload_len > sizeof(buf)) {
        return 0;
    }

    memcpy(buf + off, &ph, sizeof(ph));
    off += sizeof(ph);

    struct tcphdr tcp_copy;
    memcpy(&tcp_copy, tcp, sizeof(tcp_copy));
    tcp_copy.th_sum = 0;

    memcpy(buf + off, &tcp_copy, sizeof(tcp_copy));
    off += sizeof(tcp_copy);

    if (payload && payload_len > 0) {
        memcpy(buf + off, payload, payload_len);
        off += payload_len;
    }

    return packet_forge_checksum16(buf, off);
}

int packet_forge_build_tcp_ipv4(uint8_t* out_packet,
                                size_t out_cap,
                                size_t* out_len,
                                uint32_t src_ip_nbo,
                                uint32_t dst_ip_nbo,
                                uint16_t src_port_nbo,
                                uint16_t dst_port_nbo,
                                uint32_t seq,
                                uint32_t ack,
                                uint8_t tcp_flags,
                                const uint8_t* payload,
                                size_t payload_len,
                                uint16_t ip_id)
{
    if (!out_packet || !out_len) return -1;

    size_t ip_len = sizeof(struct ip);
    size_t tcp_len = sizeof(struct tcphdr);
    size_t total = ip_len + tcp_len + payload_len;

    if (out_cap < total) return -1;

    memset(out_packet, 0, total);

    struct ip* iph = (struct ip*)out_packet;
    struct tcphdr* tcph = (struct tcphdr*)(out_packet + ip_len);

    // IP header
    iph->ip_v = 4;
    iph->ip_hl = (uint8_t)(ip_len / 4);
    iph->ip_tos = 0;
    iph->ip_len = htons((uint16_t)total);
    iph->ip_id = htons(ip_id);
    iph->ip_off = htons(0);
    iph->ip_ttl = 64;
    iph->ip_p = IPPROTO_TCP;
    iph->ip_src.s_addr = src_ip_nbo;
    iph->ip_dst.s_addr = dst_ip_nbo;

    iph->ip_sum = 0;
    iph->ip_sum = packet_forge_checksum16(iph, ip_len);

    // TCP header
    tcph->th_sport = src_port_nbo;
    tcph->th_dport = dst_port_nbo;
    tcph->th_seq = htonl(seq);
    tcph->th_ack = htonl(ack);
    tcph->th_off = (uint8_t)(tcp_len / 4);
    tcph->th_flags = tcp_flags;
    tcph->th_win = htons(65535);
    tcph->th_urp = 0;

    // payload
    if (payload && payload_len > 0) {
        memcpy(out_packet + ip_len + tcp_len, payload, payload_len);
    }

    // TCP checksum (pseudo header)
    tcph->th_sum = 0;
    uint16_t csum = checksum_tcp_ipv4(src_ip_nbo, dst_ip_nbo, tcph,
                                      payload, payload_len);
    tcph->th_sum = csum;

    *out_len = total;
    return 0;
}
