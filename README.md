# GateGuard

AI 기반 웹 접근 제어 및 실시간 차단 시스템

---

## 1. 프로젝트 개요

GateGuard는 네트워크 트래픽을 스니핑하여  
클라이언트의 웹 요청을 실시간으로 분석하고,  
정책 기반 및 AI 기반 판단을 통해 유해 URL 접근을 차단하는 보안 시스템이다.

기존 방화벽/프록시와 달리,

- OOB (Out-of-Band) 스니핑 구조 기반
- 패킷을 직접 차단하지 않고
- 탐지 후 능동적으로 응답을 주입 (HTTP Injection + TCP RST)

하는 방식으로 동작한다.

---

## 2. 주요 목표

- 정책 기반 + AI 기반 이중 판단 구조
- 실시간 HTTP 요청 분석 및 차단
- 스니핑 환경에서도 동작 가능한 차단 방식 구현
- 관리자 UI 기반 로그 / 정책 / 인시던트 운영
- 실데이터 기반 운영 시스템 구축 (mock 제거)

---

## 3. 시스템 아키텍처

[Client]  
↓  
[Network Traffic]  
↓  
[Detection Engine (C / libpcap)]  
↓  
[Policy Engine] + [AI Scoring API]  
↓  
[Decision Manager]  
↓  
[HTTP 403 Injection + TCP RST]  
↓  
[Database (MariaDB)]  
↓  
[Admin UI (Next.js)]

---

## 4. 핵심 구성 요소

### 4.1 Detection Engine (C)

- libpcap 기반 패킷 스니핑
- HTTP 요청 파싱 (Host / Path 추출)
- 정책 매칭 및 AI API 호출
- 차단 시:
  - HTTP 403 응답 Injection
  - TCP RST 전송으로 세션 강제 종료

---

### 4.2 AI Scoring API (FastAPI)

- URL 기반 악성 판단 모델 (scikit-learn)
- `/v1/score` API 제공
- 입력: host, path
- 출력:
  - score
  - label (benign / malicious)
  - threshold
  - model_version

---

### 4.3 Admin UI (Next.js)

- Dashboard (실시간 위협 현황)
- Logs (트래픽 로그 조회)
- AI Analysis (AI 판단 결과)
- Policies (정책 관리)
- Incidents (보안 이벤트 관리)
- Users / Auth (2FA 포함)

모든 데이터는 DB 기반 실데이터로 동작

---

### 4.4 Database (MariaDB)

주요 테이블:

- policy
- policy_rule
- access_log
- ai_analysis
- review_event
- policy_audit
- user_account

특징:

- Single Source of Truth (SSOT)
- 정책 / AI / 로그 / 감사 이력 분리 설계
- 운영 및 감사 추적 가능 구조

---

## 5. 처리 흐름

1. 클라이언트 HTTP 요청 발생  
2. Detection Engine이 패킷 스니핑  
3. Host / Path 추출  
4. 정책 DB 조회  

   - 매칭 → 즉시 BLOCK  
   - 미매칭 → AI 분석 요청  

5. 최종 판단 (PASS / BLOCK / AI / FAIL_STAGE)  

6. BLOCK 시:  
   - HTTP 403 Injection  
   - TCP RST로 세션 종료  

7. 결과 DB 저장  
8. Admin UI에서 실시간 조회  

---

## 6. 차단 방식

- 서버 응답을 직접 차단하지 않음
- 위조된 HTTP 403 응답을 클라이언트에 주입
- 이후 TCP RST로 세션 종료

결과적으로 사용자 입장에서는 접속이 차단된 것처럼 보인다.

---

## 7. OOB 구조 한계

- 실제 서버 응답보다 injection이 늦으면 차단 실패 가능
- 로컬 환경에서는 타이밍 경쟁 발생 가능
- HTTPS 트래픽 직접 분석 불가

완화 방법:

- hot path 최적화
- injection 우선 실행 구조 적용

---

## 8. 테스트 시나리오

| 시나리오 | 설명 |
|--------|------|
| PASS   | 정상 URL 접근 |
| BLOCK  | 정책 기반 차단 |
| AI     | AI 기반 악성 판단 |
| FAIL   | AI 장애 시 fallback |

---

## 9. 실행 환경

### 9.1 개발 환경

- Host: Windows (192.168.1.128)
- VM: Rocky Linux (192.168.1.24)

### 9.2 실환경 (미러포트)

- Client: 192.168.100.22
- Sensor/Engine: 192.168.100.21
- Admin UI: 192.168.100.x:3000
- FastAPI: 192.168.100.x:8000

---

## 10. 최근 주요 작업 (2026-03-21 ~ 2026-03-23)

### 트래픽 자동화 고도화

- 시간대 기반 트래픽 시뮬레이션 설계 (workhours / lunch / afterhours)
- traffic_gen.sh 프로파일 기반 실행 구조 (--profile)
- PASS / BLOCK / AI / FAIL_STAGE 시나리오 분리
- 로그 및 DB(access_log / ai_analysis) 정상 적재 검증

---

### systemd 기반 자동 실행

- gateguard-traffic-workhours.service
- gateguard-traffic-lunch.service
- gateguard-traffic-afterhours.service
- OnCalendar 기반 timer 스케줄링 적용
- timer → service 자동 실행 구조 검증 완료

---

### 권한 문제 해결

- /var/log 권한 문제로 service 실패 원인 분석
- 로그 경로를 ~/GateGuard/logs 로 변경
- systemd 실행 구조 정리 및 정상 동작 확인

---

### Dashboard / 시스템 검증

- Engine / FastAPI / DB 상태 변화 UI 반영 확인
- 서비스 장애 시 영향 범위 및 전파 구조 검증
- refresh 기반 상태 반영 확인

---

### CORS 및 통신 문제 해결

- FastAPI CORS_ORIGINS에 192.168.100.x:3000 추가
- OPTIONS preflight 400 오류 해결
- Admin UI ↔ FastAPI 통신 정상화

---

### 운영 구조 정리

- Admin UI 포트 8080 → 3000 통일
- systemd 기반 서비스 실행 구조 유지
- Git PAT 인증 방식 적용 및 push 문제 해결

---

### 크론 및 스케줄링 점검

- crond.service 정상 동작 확인
- systemd timer와 cron 구조 전체 점검
- 트래픽 자동화 미등록 원인 확인 완료

---

### 미러포트 실환경 전환

- 192.168.1.x → 192.168.100.x 환경 전환
- client / sensor / admin UI 역할 분리
- Putty / WinSCP 기반 운영 동선 정리

---

### 통합 검증

- gateguard-engine.service 정상 동작
- gateguard-fastapi.service 정상 동작
- gateguard-adminui.service 정상 동작
- Engine / API / UI 통신 정상 검증 완료

---

## 11. 주요 성과

- End-to-End 탐지 → 판단 → 차단 → 기록 → UI 흐름 완성
- mock 제거 → 100% 실데이터 기반 시스템
- AI 모델 고도화 (url-threat-v17)
- 운영/감사/로그 기반 구조 구현

---

## 12. 향후 개선 방향

- HTTPS 트래픽 처리
- 스트림 기반 처리 구조 개선
- AI 모델 정밀도 향상
- 분산 환경 대응 및 성능 최적화

---

## 13. 결론

GateGuard는 스니핑 기반 환경에서도 동작하는 능동형 차단 시스템으로

- 정책 + AI 결합 탐지
- 실시간 차단 및 대응
- 관리자 기반 운영

을 구현한 보안 프로젝트이다.
