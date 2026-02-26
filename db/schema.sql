CREATE DATABASE IF NOT EXISTS gateguard
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE gateguard;

-- =========================================
-- 1) policy
-- 기술서(2026-02-13) 기준
-- =========================================
CREATE TABLE IF NOT EXISTS policy (
  policy_id BIGINT NOT NULL AUTO_INCREMENT,
  policy_name VARCHAR(100) NOT NULL,
  policy_type ENUM('ALLOWLIST','BLOCKLIST','MONITOR') NOT NULL,
  action ENUM('ALLOW','BLOCK','REDIRECT','REVIEW') NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  risk_level ENUM('LOW','MEDIUM','HIGH','CRITICAL') NULL,
  category VARCHAR(50) NULL,
  block_status_code SMALLINT NULL DEFAULT 403,
  redirect_url VARCHAR(255) NULL,
  description TEXT NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by BIGINT NULL,

  PRIMARY KEY (policy_id),
  UNIQUE KEY uq_policy_policy_name (policy_name),
  KEY idx_policy_policy_type (policy_type),
  KEY idx_policy_category (category),
  KEY idx_policy_created_by (created_by),
  KEY idx_policy_updated_by (updated_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================================
-- 2) policy_rule
-- 기술서(2026-02-13) 기준
-- =========================================
CREATE TABLE IF NOT EXISTS policy_rule (
  rule_id BIGINT NOT NULL AUTO_INCREMENT,
  policy_id BIGINT NOT NULL,
  rule_type ENUM('HOST','PATH','URL') NOT NULL,
  match_type ENUM('EXACT','PREFIX','CONTAINS','REGEX') NOT NULL,
  pattern VARCHAR(512) NOT NULL,
  is_case_sensitive TINYINT(1) NOT NULL DEFAULT 0,
  is_negated TINYINT(1) NOT NULL DEFAULT 0,
  rule_order INT NOT NULL DEFAULT 0,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (rule_id),
  KEY idx_policy_rule_policy_id (policy_id),
  KEY idx_policy_rule_order (policy_id, rule_order),
  CONSTRAINT fk_policy_rule_policy
    FOREIGN KEY (policy_id) REFERENCES policy(policy_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================================
-- 3) access_log
-- 기술서(2026-02-13) 기준
-- =========================================
CREATE TABLE IF NOT EXISTS access_log (
  log_id BIGINT NOT NULL AUTO_INCREMENT,
  request_id CHAR(36) NOT NULL,
  detect_timestamp DATETIME NOT NULL,
  client_ip VARCHAR(45) NOT NULL,
  client_port INT NULL,
  server_ip VARCHAR(45) NULL,
  server_port INT NULL,
  host VARCHAR(255) NOT NULL,
  path VARCHAR(512) NULL,
  method VARCHAR(10) NULL,
  url_norm VARCHAR(512) NULL,
  decision ENUM('ALLOW','BLOCK','REVIEW','ERROR') NOT NULL,
  reason ENUM('POLICY','AI','SYSTEM') NOT NULL,
  decision_stage ENUM('POLICY_STAGE','AI_STAGE','FAIL_STAGE') NOT NULL,
  policy_id BIGINT NULL,
  user_agent VARCHAR(255) NULL,
  engine_latency_ms INT NULL,
  inject_attempted TINYINT(1) NOT NULL DEFAULT 0,
  inject_send TINYINT(1) NULL,
  inject_errno INT NULL,
  inject_latency_ms INT NULL,
  inject_status_code SMALLINT NULL,

  PRIMARY KEY (log_id),
  UNIQUE KEY uq_access_log_request_id (request_id),
  KEY idx_access_log_detect_timestamp (detect_timestamp),
  KEY idx_access_log_policy_id (policy_id),
  KEY idx_access_log_host (host),
  KEY idx_access_log_client_ip (client_ip),
  KEY idx_access_log_decision (decision),
  CONSTRAINT fk_access_log_policy
    FOREIGN KEY (policy_id) REFERENCES policy(policy_id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================================
-- 4) ai_analysis
-- 기술서(2026-02-13) 기준
-- =========================================
CREATE TABLE IF NOT EXISTS ai_analysis (
  ai_analysis_id BIGINT NOT NULL AUTO_INCREMENT,
  log_id BIGINT NOT NULL,
  analyzed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  score DECIMAL(5,4) NULL,
  label VARCHAR(20) NULL,
  ai_response TINYINT(1) NOT NULL DEFAULT 1,
  latency_ms INT NULL,
  model_version VARCHAR(50) NOT NULL,
  error_code VARCHAR(20) NULL,
  analysis_seq INT NOT NULL DEFAULT 0,

  PRIMARY KEY (ai_analysis_id),
  UNIQUE KEY uq_ai_analysis_log_seq (log_id, analysis_seq),
  KEY idx_ai_analysis_log_id (log_id),
  KEY idx_ai_analysis_analyzed_at (analyzed_at),
  CONSTRAINT fk_ai_analysis_access_log
    FOREIGN KEY (log_id) REFERENCES access_log(log_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================================
-- 5) policy_audit
-- 기술서(2026-02-13) 기준
-- (changed_by는 auth_user FK 걸고 싶지만 지금은 보류 가능)
-- =========================================
CREATE TABLE IF NOT EXISTS policy_audit (
  audit_id BIGINT NOT NULL AUTO_INCREMENT,
  policy_id BIGINT NOT NULL,
  action ENUM('CREATE','UPDATE','DELETE') NOT NULL,
  changed_by BIGINT NOT NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  before_snapshot JSON NULL,
  after_snapshot JSON NULL,
  source_review_id BIGINT NULL,
  change_note VARCHAR(255) NULL,

  PRIMARY KEY (audit_id),
  KEY idx_policy_audit_policy_id (policy_id),
  KEY idx_policy_audit_action (action),
  KEY idx_policy_audit_changed_at (changed_at),
  KEY idx_policy_audit_changed_by (changed_by),
  KEY idx_policy_audit_source_review_id (source_review_id),
  CONSTRAINT fk_policy_audit_policy
    FOREIGN KEY (policy_id) REFERENCES policy(policy_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================================
-- 6) review_event
-- 기술서(2026-02-13) 기준
-- =========================================
CREATE TABLE IF NOT EXISTS review_event (
  review_id BIGINT NOT NULL AUTO_INCREMENT,
  log_id BIGINT NOT NULL,
  status ENUM('OPEN','IN_PROGRESS','CLOSED') NOT NULL DEFAULT 'OPEN',
  proposed_action ENUM('ALLOW','BLOCK','CREATE_POLICY','UPDATE_POLICY','NO_ACTION') NULL,
  reviewer_id BIGINT NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note VARCHAR(255) NULL,
  generated_policy_id BIGINT NULL,

  PRIMARY KEY (review_id),
  KEY idx_review_event_log_id (log_id),
  KEY idx_review_event_status (status),
  KEY idx_review_event_created_at (created_at),
  KEY idx_review_event_reviewer_id (reviewer_id),
  KEY idx_review_event_generated_policy_id (generated_policy_id),
  CONSTRAINT fk_review_event_log
    FOREIGN KEY (log_id) REFERENCES access_log(log_id)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT fk_review_event_generated_policy
    FOREIGN KEY (generated_policy_id) REFERENCES policy(policy_id)
    ON DELETE SET NULL
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
