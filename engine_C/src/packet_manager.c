#include "packet_manager.h"
#include "packet_extractor.h"

int packet_manager_run(const char* ifname)
{
    return packet_extractor_run_pcap_loop(ifname);
}
