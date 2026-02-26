// src/decision_manager.c
#include "decision_manager.h"

#include <string.h>

action_t decision_manager_decide(const ai_result_t* ar, double threshold)
{
    if (!ar || !ar->ok) return ACT_REVIEW;

    double th = (threshold > 0.0) ? threshold : 0.5;

    if (ar->score >= th) return ACT_BLOCK;

    // benign + 충분히 낮은 점수면 allow (MVP 규칙)
    if (ar->label[0] && strcmp(ar->label, "benign") == 0) {
        if (ar->score < th * 0.5) return ACT_ALLOW;
    }

    return ACT_REVIEW;
}


