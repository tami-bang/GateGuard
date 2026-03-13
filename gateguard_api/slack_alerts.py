from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional


ROUTE_SOC = "soc"
ROUTE_SECURITY_CONFIG = "security_config"
ROUTE_INFRA = "infra"
ROUTE_PLATFORM_DEV = "platform_dev"


def _env_bool(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name, "")).strip().lower()
    if raw == "":
        return default
    return raw in {"1", "true", "yes", "y", "on"}


def _now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def alerts_enabled() -> bool:
    return _env_bool("SLACK_ALERTS_ENABLED", False)


def _truncate(value: Any, limit: int = 300) -> str:
    s = str(value if value is not None else "")
    if len(s) <= limit:
        return s
    return s[: limit - 3] + "..."


def _header(severity: str, title: str) -> str:
    return f"[{severity}] {title}"


def _webhook_for_route(route: str) -> Optional[str]:
    mapping = {
        ROUTE_SOC: os.getenv("SLACK_WEBHOOK_SOC", "").strip(),
        ROUTE_SECURITY_CONFIG: os.getenv("SLACK_WEBHOOK_SECURITY_CONFIG", "").strip(),
        ROUTE_INFRA: os.getenv("SLACK_WEBHOOK_INFRA", "").strip(),
        ROUTE_PLATFORM_DEV: os.getenv("SLACK_WEBHOOK_PLATFORM_DEV", "").strip(),
    }
    webhook = mapping.get(route) or ""
    return webhook if webhook else None


def _post_webhook(webhook_url: str, payload: dict, timeout_sec: int = 5) -> bool:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            return 200 <= int(resp.status) < 300
    except urllib.error.URLError as e:
        print(f"[SlackAlerts] webhook send failed: {e}")
        return False
    except Exception as e:
        print(f"[SlackAlerts] webhook send failed: {e}")
        return False


def send_text(route: str, text: str) -> bool:
    if not alerts_enabled():
        return False

    webhook = _webhook_for_route(route)
    if not webhook:
        print(f"[SlackAlerts] webhook missing for route={route}")
        return False

    return _post_webhook(webhook, {"text": text})


def send_blocks(route: str, text: str, blocks: List[dict]) -> bool:
    if not alerts_enabled():
        return False

    webhook = _webhook_for_route(route)
    if not webhook:
        print(f"[SlackAlerts] webhook missing for route={route}")
        return False

    payload = {
        "text": text,
        "blocks": blocks,
    }
    return _post_webhook(webhook, payload)


def _policy_name_from_snapshot(after_snapshot: Optional[dict], before_snapshot: Optional[dict]) -> str:
    for snap in [after_snapshot, before_snapshot]:
        if isinstance(snap, dict):
            policy_obj = snap.get("policy") or {}
            name = policy_obj.get("policy_name")
            if name:
                return str(name)
    return "unknown"


def _index_rules(rules: List[dict]) -> Dict[str, dict]:
    result: Dict[str, dict] = {}
    for idx, rule in enumerate(rules or []):
        if not isinstance(rule, dict):
            continue

        if rule.get("rule_id") is not None:
            key = f"rule_id={rule.get('rule_id')}"
        else:
            key = (
                f"{rule.get('rule_type', '?')}|"
                f"{rule.get('match_type', '?')}|"
                f"{rule.get('pattern', '?')}|"
                f"{rule.get('rule_order', idx)}"
            )
        result[key] = rule
    return result


def summarize_policy_diff(
    before_snapshot: Optional[dict],
    after_snapshot: Optional[dict],
    max_lines: int = 10,
) -> List[str]:
    lines: List[str] = []

    before_snapshot = before_snapshot or {}
    after_snapshot = after_snapshot or {}

    before_policy = before_snapshot.get("policy") or {}
    after_policy = after_snapshot.get("policy") or {}

    ignore_policy_fields = {"created_at", "updated_at"}

    for key in sorted(set(before_policy.keys()) | set(after_policy.keys())):
        if key in ignore_policy_fields:
            continue
        before_val = before_policy.get(key)
        after_val = after_policy.get(key)
        if before_val != after_val:
            lines.append(f"- policy.{key}: {before_val} -> {after_val}")

    before_rules = _index_rules(before_snapshot.get("rules") or [])
    after_rules = _index_rules(after_snapshot.get("rules") or [])

    for rule_key in sorted(set(before_rules.keys()) | set(after_rules.keys())):
        before_rule = before_rules.get(rule_key)
        after_rule = after_rules.get(rule_key)

        if before_rule is None and after_rule is not None:
            lines.append(
                f"- rule created: {after_rule.get('rule_type')}/{after_rule.get('match_type')} "
                f"pattern={after_rule.get('pattern')}"
            )
            continue

        if before_rule is not None and after_rule is None:
            lines.append(
                f"- rule deleted: {before_rule.get('rule_type')}/{before_rule.get('match_type')} "
                f"pattern={before_rule.get('pattern')}"
            )
            continue

        if not isinstance(before_rule, dict) or not isinstance(after_rule, dict):
            continue

        ignore_rule_fields = {"created_at", "updated_at"}
        for field in sorted(set(before_rule.keys()) | set(after_rule.keys())):
            if field in ignore_rule_fields:
                continue
            before_val = before_rule.get(field)
            after_val = after_rule.get(field)
            if before_val != after_val:
                lines.append(f"- {rule_key}.{field}: {before_val} -> {after_val}")

    if len(lines) > max_lines:
        remain = len(lines) - max_lines
        lines = lines[:max_lines]
        lines.append(f"- ... and {remain} more changes")

    return lines


def _mrkdwn_section(text: str) -> dict:
    return {
        "type": "section",
        "text": {
            "type": "mrkdwn",
            "text": text,
        },
    }


def _header_block(text: str) -> dict:
    return {
        "type": "header",
        "text": {
            "type": "plain_text",
            "text": _truncate(text, 150),
        },
    }


def _divider_block() -> dict:
    return {"type": "divider"}


def _kv_lines(pairs: List[tuple[str, Any]]) -> str:
    rows: List[str] = []
    for key, value in pairs:
        rows.append(f"*{key}*\n{value if value is not None else '-'}")
    return "\n".join(rows)


def _severity_from_policy(before_snapshot: Optional[dict], after_snapshot: Optional[dict]) -> str:
    before_policy = (before_snapshot or {}).get("policy") or {}
    after_policy = (after_snapshot or {}).get("policy") or {}

    if before_policy.get("is_enabled") == 1 and after_policy.get("is_enabled") == 0:
        return "HIGH"

    risk_level = str(after_policy.get("risk_level") or before_policy.get("risk_level") or "").upper()
    if risk_level in {"HIGH", "CRITICAL"}:
        return "HIGH"
    if risk_level == "LOW":
        return "LOW"
    return "MEDIUM"


def _format_diff_lines_for_slack(diff_lines: List[str]) -> str:
    if not diff_lines:
        return "_No field-level changes detected_"
    return "\n".join(diff_lines)


def send_policy_change_alert(
    *,
    event_action: str,
    policy_id: int,
    changed_by: int,
    before_snapshot: Optional[dict],
    after_snapshot: Optional[dict],
    change_note: Optional[str] = None,
    source_review_id: Optional[int] = None,
) -> bool:
    severity = _severity_from_policy(before_snapshot, after_snapshot)
    policy_name = _policy_name_from_snapshot(after_snapshot, before_snapshot)
    diff_lines = summarize_policy_diff(before_snapshot, after_snapshot, max_lines=10)

    after_policy = (after_snapshot or {}).get("policy") or {}
    before_policy = (before_snapshot or {}).get("policy") or {}

    risk_level = after_policy.get("risk_level") or before_policy.get("risk_level") or "-"
    action = after_policy.get("action") or before_policy.get("action") or "-"
    policy_type = after_policy.get("policy_type") or before_policy.get("policy_type") or "-"
    is_enabled = after_policy.get("is_enabled")
    is_enabled_text = "Enabled" if int(is_enabled or 0) == 1 else "Disabled"

    summary_text = f"[{severity}] GateGuard Policy {event_action}: {policy_name}"

    blocks: List[dict] = [
        _header_block(f"GateGuard Policy {event_action}"),
        _mrkdwn_section(
            _kv_lines([
                ("Severity", severity),
                ("Policy ID", policy_id),
                ("Policy Name", policy_name),
                ("Policy Type", policy_type),
                ("Action", action),
                ("Risk Level", risk_level),
                ("Status", is_enabled_text),
            ])
        ),
        _divider_block(),
        _mrkdwn_section(
            _kv_lines([
                ("Changed By", f"user_id={changed_by}"),
                ("Changed At", _now_str()),
                ("Source Review ID", source_review_id if source_review_id is not None else "-"),
            ])
        ),
    ]

    if change_note:
        blocks.extend([
            _divider_block(),
            _mrkdwn_section(f"*Change Note*\n{_truncate(change_note, 255)}"),
        ])

    blocks.extend([
        _divider_block(),
        _mrkdwn_section(f"*Changed Fields*\n{_format_diff_lines_for_slack(diff_lines)}"),
    ])

    return send_blocks(ROUTE_SECURITY_CONFIG, summary_text, blocks)


def send_ai_block_alert(
    *,
    log_id: int,
    detected_at: str,
    client_ip: str,
    host: str,
    path: Optional[str],
    score: Optional[float],
    label: Optional[str],
    model_version: Optional[str],
    request_id: Optional[str],
) -> bool:
    summary_text = f"[CRITICAL] GateGuard Threat Blocked: {host or '-'}"

    blocks: List[dict] = [
        _header_block("GateGuard Threat Blocked"),
        _mrkdwn_section(
            _kv_lines([
                ("Severity", "CRITICAL"),
                ("Decision", "BLOCK"),
                ("Stage", "AI_STAGE"),
                ("Detected At", detected_at),
            ])
        ),
        _divider_block(),
        _mrkdwn_section(
            _kv_lines([
                ("Log ID", log_id),
                ("Client IP", client_ip or "-"),
                ("Host", host or "-"),
                ("Path", path or "/"),
            ])
        ),
        _divider_block(),
        _mrkdwn_section(
            _kv_lines([
                ("AI Score", score if score is not None else "-"),
                ("AI Label", label or "-"),
                ("Model Version", model_version or "-"),
                ("Request ID", request_id or "-"),
            ])
        ),
    ]

    return send_blocks(ROUTE_SOC, summary_text, blocks)


def send_repeat_block_alert(
    *,
    client_ip: str,
    blocked_count: int,
    window_minutes: int,
) -> bool:
    summary_text = f"[HIGH] GateGuard Repeated Block Activity: {client_ip}"

    blocks: List[dict] = [
        _header_block("GateGuard Repeated Block Activity"),
        _mrkdwn_section(
            _kv_lines([
                ("Severity", "HIGH"),
                ("Client IP", client_ip),
                ("Blocked Count", blocked_count),
                ("Window", f"last {window_minutes} minute(s)"),
            ])
        ),
        _divider_block(),
        _mrkdwn_section("*Analysis*\nPossible repeated malicious access or infected client."),
    ]

    return send_blocks(ROUTE_SOC, summary_text, blocks)


def send_ai_error_summary_alert(
    *,
    error_code: str,
    count: int,
    latest_at: str,
    example_log_id: Optional[int],
) -> bool:
    summary_text = f"[HIGH] GateGuard AI Scoring Failure Summary: {error_code or 'UNKNOWN'}"

    blocks: List[dict] = [
        _header_block("GateGuard AI Scoring Failure Summary"),
        _mrkdwn_section(
            _kv_lines([
                ("Severity", "HIGH"),
                ("Error Code", error_code or "UNKNOWN"),
                ("Count", count),
                ("Latest At", latest_at),
                ("Example Log ID", example_log_id if example_log_id is not None else "-"),
            ])
        ),
    ]

    return send_blocks(ROUTE_INFRA, summary_text, blocks)


def send_infra_status_alert(
    *,
    component: str,
    previous_status: Optional[str],
    current_status: str,
) -> bool:
    down_states = {"inactive", "failed", "missing", "unknown", "degraded"}
    is_down = str(current_status).lower() in down_states

    severity = "CRITICAL" if is_down else "INFO"
    title = "GateGuard Service Down" if is_down else "GateGuard Service Recovered"
    summary_text = f"[{severity}] {title}: {component}"

    blocks: List[dict] = [
        _header_block(title),
        _mrkdwn_section(
            _kv_lines([
                ("Severity", severity),
                ("Component", component),
                ("Previous Status", previous_status or "-"),
                ("Current Status", current_status),
                ("Detected At", _now_str()),
            ])
        ),
    ]

    return send_blocks(ROUTE_INFRA, summary_text, blocks)


def send_platform_error_alert(
    *,
    endpoint: str,
    error_message: str,
) -> bool:
    summary_text = f"[HIGH] GateGuard Platform Error: {endpoint}"

    blocks: List[dict] = [
        _header_block("GateGuard Platform Error"),
        _mrkdwn_section(
            _kv_lines([
                ("Severity", "HIGH"),
                ("Endpoint", endpoint),
                ("Detected At", _now_str()),
            ])
        ),
        _divider_block(),
        _mrkdwn_section(f"*Error Message*\n```{_truncate(error_message, 400)}```"),
    ]

    return send_blocks(ROUTE_PLATFORM_DEV, summary_text, blocks)
