// include/raw_socket_sender.h
#pragma once
#include <stdint.h>
#include <stddef.h>

int raw_sender_init(void);
int raw_send_ipv4(const uint8_t *packet, size_t packet_len, uint32_t dst_ip_nbo, int *out_errno);
void raw_sender_close(void);
