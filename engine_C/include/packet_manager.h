#ifndef PACKET_MANAGER_H
#define PACKET_MANAGER_H

#ifdef __cplusplus
extern "C" {
#endif

/*  캡처 파이프라인 관리 (내부에서 packet_extractor 사용) */
int packet_manager_run(const char* ifname);

#ifdef __cplusplus
}
#endif

#endif /* PACKET_MANAGER_H */
