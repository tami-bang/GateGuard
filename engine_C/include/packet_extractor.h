#ifndef PACKET_EXTRACTOR_H
#define PACKET_EXTRACTOR_H

#ifdef __cplusplus
extern "C" {
#endif

/* pcap 루프 시작 (HTTP 후보를 추출해 process_http_request() 호출) */
int packet_extractor_run_pcap_loop(const char* ifname);

#ifdef __cplusplus
}
#endif

#endif /* PACKET_EXTRACTOR_H */
