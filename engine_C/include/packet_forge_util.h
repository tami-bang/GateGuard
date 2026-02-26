// include/packet_forge_util.h
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

uint16_t packet_forge_checksum16(const void* data, size_t len);

/*
 * TCP/IPv4 forged packet builder
 * - src/dst ip/port는 NBO(network byte order)로 받음
 * - seq/ack은 host order로 받음 (함수 내부에서 htonl)
 * - out_packet에 [IP header][TCP header][payload]로 채움
 */
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
                                uint16_t ip_id);

#ifdef __cplusplus
}
#endif
