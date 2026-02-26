// src/raw_socket_sender.c
#include "raw_socket_sender.h"

#include <errno.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>

static int g_raw_fd = -1;

int raw_sender_init(void) {
    if (g_raw_fd >= 0) return 0;

    g_raw_fd = socket(AF_INET, SOCK_RAW, IPPROTO_RAW);
    if (g_raw_fd < 0) return -1;

    int on = 1;
    if (setsockopt(g_raw_fd, IPPROTO_IP, IP_HDRINCL, &on, sizeof(on)) < 0) {
        close(g_raw_fd);
        g_raw_fd = -1;
        return -1;
    }
    return 0;
}

int raw_send_ipv4(const uint8_t *packet, size_t packet_len, uint32_t dst_ip_nbo, int *out_errno) {
    if (out_errno) *out_errno = 0;
    if (g_raw_fd < 0 && raw_sender_init() < 0) {
        if (out_errno) *out_errno = errno;
        return -1;
    }

    struct sockaddr_in dst;
    memset(&dst, 0, sizeof(dst));
    dst.sin_family = AF_INET;
    dst.sin_addr.s_addr = dst_ip_nbo;

    ssize_t n = sendto(g_raw_fd, packet, packet_len, 0, (struct sockaddr *)&dst, sizeof(dst));
    if (n < 0 || (size_t)n != packet_len) {
        if (out_errno) *out_errno = errno;
        return -1;
    }
    return 0;
}

void raw_sender_close(void) {
    if (g_raw_fd >= 0) close(g_raw_fd);
    g_raw_fd = -1;
}
