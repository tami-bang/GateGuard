from __future__ import annotations

import json
import os
import time
from typing import Optional


def _state_file() -> str:
    return os.getenv("ALERT_STATE_FILE", "/var/tmp/gateguard-alert-state.json").strip()


def _default_state() -> dict:
    return {
        "dedup": {},
        "component_status": {},
    }


def load_state() -> dict:
    path = _state_file()
    if not os.path.exists(path):
        return _default_state()

    try:
        with open(path, "r", encoding="utf-8") as f:
            obj = json.load(f)
        if not isinstance(obj, dict):
            return _default_state()
        if "dedup" not in obj or not isinstance(obj["dedup"], dict):
            obj["dedup"] = {}
        if "component_status" not in obj or not isinstance(obj["component_status"], dict):
            obj["component_status"] = {}
        return obj
    except Exception:
        return _default_state()


def save_state(state: dict) -> None:
    path = _state_file()
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)

    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

    os.replace(tmp_path, path)


def dedup_allow_send(key: str, window_sec: int) -> bool:
    state = load_state()
    now_ts = int(time.time())

    dedup = state.setdefault("dedup", {})
    last_ts = int(dedup.get(key, 0) or 0)

    if last_ts > 0 and (now_ts - last_ts) < int(window_sec):
        return False

    dedup[key] = now_ts
    save_state(state)
    return True


def update_component_status(component: str, current_status: str) -> Optional[str]:
    state = load_state()
    status_map = state.setdefault("component_status", {})

    previous_status = status_map.get(component)
    if previous_status == current_status:
        return None

    status_map[component] = current_status
    save_state(state)
    return previous_status
