# GateGuard

AI 기반 웹 접근 제어 및 실시간 차단 시스템

---

## 프로젝트 개요

GateGuard는 네트워크 트래픽을 스니핑하여  
클라이언트의 웹 요청을 실시간으로 분석하고,  
정책 기반 및 AI 기반 판단을 통해 유해 URL 접근을 차단하는 보안 시스템이다.

기존 방화벽/프록시와 달리,  
OOB(Out-of-Band) 스니핑 구조에서 동작하며  
패킷을 가로채지 않고 탐지 후 능동적으로 응답을 주입(injection)하여 차단을 수행한다.

---

## 주요 목표

- 정책 기반 + AI 기반 이중 판단 구조
- 실시간 HTTP 요청 분석 및 차단
- 스니핑 환경에서도 동작 가능한 차단 방식 구현
- 관리자 UI 기반 로그/정책/인시던트 관리

---

## 시스템 아키텍처

    [Client]
       ↓
    [Network Traffic]
       ↓
    [Detection Engine (C / libpcap)]
       ↓
     ┌───────────────┬───────────────┐
     │ Policy Engine │ AI Scoring API│
     └───────────────┴───────────────┘
       ↓
    [Decision Manager]
       ↓
    [HTTP 403 Injection + TCP RST]
       ↓
    [Database (MySQL)]
       ↓
    [Admin UI (Next.js)]

---

## 핵심 구성 요소

### 1. Detection Engine (C)

- libpcap 기반 패킷 스니핑
- HTTP 요청 파싱 (Host, Path 추출)
- 정책 매칭 및 AI API 호출
- 차단 시 HTTP 403 응답 injection + TCP RST 전송

---

### 2. AI Scoring API (FastAPI)

- URL 기반 악성 판단 모델 (scikit-learn)
- `/v1/score` 엔드포인트 제공
- score / label 반환

---

### 3. Admin UI (Next.js)

- Dashboard (실시간 위협 현황)
- Logs (트래픽 로그 조회)
- AI Analysis (AI 판단 결과)
- Policies (정책 관리)
- Incidents (보안 이벤트 관리)
- Users / Auth (2FA 포함)

모든 데이터는 DB 기반 실데이터로 동작 (mock 제거 완료)

---

### 4. Database (MySQL)

주요 테이블:

- policy
- policy_rule
- access_log
- ai_analysis
- review_event

단일 SSOT 구조 유지

---

## 처리 흐름

1. 클라이언트 HTTP 요청 발생  
2. Detection Engine이 패킷 스니핑  
3. Host / Path 추출  
4. 정책 DB 조회  
   - 매칭 → 즉시 BLOCK  
   - 미매칭 → AI 분석 요청  
5. 최종 판단 (PASS / BLOCK / AI / FAIL)  
6. BLOCK 시:
   - 클라이언트에 HTTP 403 injection  
   - TCP RST로 세션 종료  
7. 결과 DB 저장  
8. Admin UI에서 실시간 조회  

---

## 차단 방식

- 클라이언트 → 서버 요청을 직접 막지 않음
- 위조된 HTTP 403 응답을 클라이언트에 주입
- 이후 양방향 TCP RST 전송으로 세션 강제 종료

결과적으로 사용자 입장에서는 접속이 차단된 것처럼 보인다.

---

## OOB 구조 한계

- 실제 서버 응답보다 injection이 늦으면 차단 실패 가능
- 로컬 환경에서는 타이밍 경쟁 발생 가능
- HTTPS 트래픽은 직접 분석 불가

완화 방법:

- hot path 최적화
- injection 우선 실행 구조 적용

---

## 테스트 시나리오

| 시나리오 | 설명 |
|--------|------|
| PASS | 정상 URL 접근 |
| BLOCK | 정책 기반 차단 |
| AI | AI 기반 악성 판단 |
| FAIL | AI 장애 시 fallback 처리 |

---

## 실행 환경

### 현재 개발 환경

- Host: Windows (192.168.1.128)
- VM: Rocky Linux (192.168.1.24)

### 향후 확장 환경

- Client: 192.168.100.22
- Sensor/Engine: 192.168.100.21

---

## 주요 성과

- End-to-End 흐름 완성
- mock 데이터 제거 → 100% 실데이터 기반 UI
- AI 모델 고도화 (url-threat-v17)
- Admin UI 완성

---

## 코드 품질

- mock 및 백업 파일 제거 완료
- TODO / debug 코드 제거 완료
- 치명적 dead code 없음
- 일부 로컬 중복 존재 (운영 기준 허용)

---

## 향후 개선 방향

- HTTPS 트래픽 처리
- 스트림 기반 처리 구조 개선
- AI 모델 고도화
- 분산 환경 최적화

---

## 결론

GateGuard는 스니핑 기반 환경에서도 동작하는 능동형 차단 시스템으로

- 정책 + AI 결합
- 실시간 탐지 및 대응
- 관리자 기반 운영

을 구현한 보안 프로젝트이다.
