export type HelpSection = {
  title: string
  body: string[]
}

export type PageHelpContent = {
  title: string
  description: string
  sections: HelpSection[]
}

const DEFAULT_HELP: PageHelpContent = {
  title: "GateGuard 사용 가이드",
  description: "현재 화면에서 필요한 기본 사용법을 확인할 수 있습니다.",
  sections: [
    {
      title: "기본 원칙",
      body: [
        "모든 목록 페이지의 필터는 실제 데이터 기준으로 조회되어야 합니다.",
        "상세 페이지에서 뒤로 돌아오면 이전 목록 상태와 검색 조건을 유지하는 것이 원칙입니다.",
        "중요 작업(정책 생성/수정/삭제, 인시던트 처리)은 감사 이력과 연결되어야 합니다.",
      ],
    },
  ],
}

function starts(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(base + "/")
}

export function getPageHelp(pathname: string): PageHelpContent {
  if (starts(pathname, "/dashboard")) {
    return {
      title: "Dashboard 사용 가이드",
      description: "전체 운영 현황을 한눈에 확인하는 메인 화면입니다.",
      sections: [
        {
          title: "무엇을 보는 페이지인가",
          body: [
            "전체 요청 수, 차단 수, AI 차단 비율, 정책 차단 비율, 오픈 인시던트 수를 확인합니다.",
            "최근 이벤트와 시간대별 트래픽/차단 추이를 확인합니다.",
          ],
        },
        {
          title: "실무 사용 포인트",
          body: [
            "이상 징후가 보이면 Logs 또는 Incidents로 바로 이동해 상세 분석합니다.",
            "최근 이벤트에서 반복 차단 IP, 특정 host/path 집중 여부를 먼저 확인합니다.",
          ],
        },
      ],
    }
  }

  if (starts(pathname, "/logs")) {
    return {
      title: "Logs 사용 가이드",
      description: "탐지 엔진이 수집한 요청과 최종 판단 결과를 조회합니다.",
      sections: [
        {
          title: "주요 컬럼",
          body: [
            "decision: 최종 허용/차단/리뷰 결과입니다.",
            "decision_stage: POLICY_STAGE, AI_STAGE, FAIL_STAGE 등 판단 단계입니다.",
            "ai_score: AI가 계산한 위험 점수입니다.",
            "inject_status_code: 차단 응답 주입 결과를 나타냅니다.",
          ],
        },
        {
          title: "실무 사용 포인트",
          body: [
            "host, path, client_ip, decision, stage 기준으로 먼저 좁혀서 봅니다.",
            "차단 실패나 예외 케이스는 inject 관련 컬럼과 ai_error_code를 함께 확인합니다.",
          ],
        },
      ],
    }
  }

  if (starts(pathname, "/incidents")) {
    return {
      title: "Incidents 사용 가이드",
      description: "운영자가 검토해야 하는 보안 이벤트를 관리하는 화면입니다.",
      sections: [
        {
          title: "주요 컬럼",
          body: [
            "status: OPEN, IN_PROGRESS, CLOSED 상태를 의미합니다.",
            "proposed_action: 권장 조치 방향입니다.",
            "generated_policy_id: 인시던트 처리 과정에서 생성된 정책 ID입니다.",
          ],
        },
        {
          title: "실무 사용 포인트",
          body: [
            "오탐/미탐 판단 후 상태를 갱신하고 필요한 경우 정책을 생성합니다.",
            "인시던트에서 생성한 정책은 감사 이력과 함께 추적 가능해야 합니다.",
          ],
        },
      ],
    }
  }

  if (starts(pathname, "/policies")) {
    return {
      title: "Policies 사용 가이드",
      description: "차단/허용/모니터링 정책을 생성하고 수정하는 화면입니다.",
      sections: [
        {
          title: "주요 컬럼",
          body: [
            "policy_type: ALLOWLIST, BLOCKLIST, MONITOR 유형입니다.",
            "action: 실제 동작 방식입니다.",
            "risk_level: 정책 중요도를 나타냅니다.",
            "is_enabled: 활성/비활성 상태입니다.",
          ],
        },
        {
          title: "실무 사용 포인트",
          body: [
            "정책 필터는 전체 데이터 기준으로 동작해야 하며 현재 페이지 데이터만 필터링하면 안 됩니다.",
            "수정/삭제/룰 변경은 감사 로그에 남아야 합니다.",
            "비활성화는 soft delete 성격이므로 운영 영향 범위를 확인하고 실행합니다.",
          ],
        },
      ],
    }
  }

  if (starts(pathname, "/ai-analysis")) {
    return {
      title: "AI Analysis 사용 가이드",
      description: "AI 분석 결과를 확인하고 모델 동작 상태를 점검하는 화면입니다.",
      sections: [
        {
          title: "주요 컬럼",
          body: [
            "score: 위험 점수입니다.",
            "label: benign / malicious 등 분류 결과입니다.",
            "model_version: 어떤 모델이 사용되었는지 보여줍니다.",
            "latency_ms: 추론 지연 시간입니다.",
          ],
        },
      ],
    }
  }

  if (starts(pathname, "/audit-log")) {
    return {
      title: "Audit Log 사용 가이드",
      description: "정책 변경 이력을 추적하고 before/after diff를 확인하는 화면입니다.",
      sections: [
        {
          title: "주요 컬럼",
          body: [
            "action: CREATE, UPDATE, DELETE, RULE_CREATE 등 변경 유형입니다.",
            "changed_by: 누가 변경했는지 나타냅니다.",
            "source_review_id: 어떤 인시던트에서 생성/변경되었는지 연결합니다.",
          ],
        },
        {
          title: "실무 사용 포인트",
          body: [
            "정책 변경은 반드시 감사 로그에서 추적 가능해야 합니다.",
            "변경 diff와 raw snapshot을 함께 보고 실제 영향 범위를 확인합니다.",
          ],
        },
      ],
    }
  }

  if (starts(pathname, "/users")) {
    return {
      title: "Users 사용 가이드",
      description: "직원 계정과 권한, 2FA 상태를 관리하는 화면입니다.",
      sections: [
        {
          title: "주요 관리 항목",
          body: [
            "role: Admin / Operator / Engineer 등 역할입니다.",
            "is_active: 계정 활성 상태입니다.",
            "is_2fa_enabled: OTP 기반 2차 인증 사용 여부입니다.",
          ],
        },
        {
          title: "실무 사용 포인트",
          body: [
            "비활성 계정은 즉시 운영 접근이 차단되어야 합니다.",
            "권한 변경, 2FA 초기화, 신규 계정 생성은 모두 명확한 운영 절차로 처리해야 합니다.",
          ],
        },
      ],
    }
  }

  return DEFAULT_HELP
}
