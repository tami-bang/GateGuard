// include/decision_manager.h
#pragma once

#include "policy.h"
#include "url_classification_client.h"

#ifdef __cplusplus
extern "C" {
#endif

// ar.score + threshold 기준으로 최종 action 산출
action_t decision_manager_decide(const ai_result_t* ar, double threshold);

#ifdef __cplusplus
}
#endif
