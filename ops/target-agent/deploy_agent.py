#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import queue
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

AGENT_VERSION = "deploy-agent/1.0"


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


API_URL = env("DEPLOY_CONTROL_API_URL").rstrip("/")
AGENT_TOKEN = env("DEPLOY_AGENT_TOKEN")
ALLOWED_SCRIPT_DIR = Path(env("DEPLOY_ALLOWED_SCRIPT_DIR", "/opt/scripts")).resolve()
LOG_DIR = Path(env("DEPLOY_LOG_DIR", "/home/deployer/logs/deploy")).resolve()
POLL_SECONDS = float(env("DEPLOY_AGENT_POLL_SECONDS", "2"))
CONTROL_SECONDS = float(env("DEPLOY_AGENT_CONTROL_SECONDS", "2"))
LOG_RETENTION_DAYS = float(env("DEPLOY_LOG_RETENTION_DAYS", "30"))
LOG_CLEANUP_SECONDS = float(env("DEPLOY_LOG_CLEANUP_SECONDS", "3600"))
SECONDS_PER_DAY = 24 * 60 * 60


class AgentError(Exception):
    pass


def warn(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def require_config() -> None:
    missing = [
        name
        for name, value in [
            ("DEPLOY_CONTROL_API_URL", API_URL),
            ("DEPLOY_AGENT_TOKEN", AGENT_TOKEN),
        ]
        if not value
    ]
    if missing:
        raise AgentError(f"Missing required environment variables: {', '.join(missing)}")


def api_request(path: str, payload: dict[str, Any] | None = None) -> tuple[int, Any]:
    data = None
    if payload is not None:
        data = json.dumps({"agent_version": AGENT_VERSION, **payload}).encode("utf-8")

    request = urllib.request.Request(
        f"{API_URL}{path}",
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {AGENT_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": AGENT_VERSION,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8")
        try:
            detail = json.loads(body)
        except json.JSONDecodeError:
            detail = body
        raise AgentError(f"API request failed: {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise AgentError(f"API request failed: {exc}") from exc


def post_logs(job_id: str, lines: list[str]) -> bool:
    if lines:
        try:
            api_request(f"/api/agent/jobs/{job_id}/logs/", {"lines": lines})
        except AgentError as exc:
            warn(str(exc))
            return False
    return True


def post_status(job_id: str, status: str, exit_code: int | None = None) -> bool:
    payload: dict[str, Any] = {"status": status}
    if exit_code is not None:
        payload["exit_code"] = exit_code
    try:
        api_request(f"/api/agent/jobs/{job_id}/status/", payload)
    except AgentError as exc:
        warn(str(exc))
        return False
    return True


def stop_requested(job_id: str) -> bool:
    try:
        _, payload = api_request(f"/api/agent/jobs/{job_id}/control/", {})
        return bool(payload and payload.get("stop_requested"))
    except AgentError as exc:
        warn(str(exc))
        return False


def validate_script_path(script_path: str) -> Path:
    path = Path(script_path).resolve()
    if not str(path).startswith(f"{ALLOWED_SCRIPT_DIR}/"):
        raise AgentError(f"Script path is outside {ALLOWED_SCRIPT_DIR}: {script_path}")
    if not path.is_file():
        raise AgentError(f"Script does not exist: {path}")
    if not os.access(path, os.X_OK):
        raise AgentError(f"Script is not executable: {path}")
    return path


def read_output(stream, output_queue: queue.Queue[str]) -> None:
    for line in iter(stream.readline, ""):
        output_queue.put(line.rstrip("\r\n"))
    stream.close()


def terminate_process(process: subprocess.Popen[str]) -> int:
    if process.poll() is not None:
        return process.returncode
    process.terminate()
    try:
        return process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        return process.wait(timeout=10)


def cleanup_old_logs(now: float | None = None) -> int:
    if LOG_RETENTION_DAYS <= 0:
        return 0

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    cutoff = (now if now is not None else time.time()) - (
        LOG_RETENTION_DAYS * SECONDS_PER_DAY
    )
    deleted = 0
    for path in LOG_DIR.glob("*.log"):
        try:
            if path.is_symlink() or not path.is_file():
                continue
            if path.stat().st_mtime >= cutoff:
                continue
            path.unlink()
            deleted += 1
        except OSError as exc:
            warn(f"Could not clean up old log {path}: {exc}")
    return deleted


def run_job(job: dict[str, Any]) -> None:
    job_id = job["id"]
    script_key = job["script_key"]
    run_id = f"{time.strftime('%Y%m%d_%H%M%S')}_{script_key}_{uuid.uuid4().hex[:8]}"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    local_log = LOG_DIR / f"{run_id}.log"

    try:
        script_path = validate_script_path(job["script_path"])
    except AgentError as exc:
        post_logs(job_id, [str(exc)])
        post_status(job_id, "failed", 127)
        return

    post_logs(job_id, [f"Starting {script_key} via {script_path}"])
    post_status(job_id, "running")

    output_queue: queue.Queue[str] = queue.Queue()
    env_vars = os.environ.copy()
    env_vars["PYTHONUNBUFFERED"] = "1"
    process = subprocess.Popen(
        [str(script_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env_vars,
    )
    assert process.stdout is not None
    reader = threading.Thread(target=read_output, args=(process.stdout, output_queue))
    reader.daemon = True
    reader.start()

    next_control_check = 0.0
    buffered_lines: list[str] = []
    stopped = False
    with local_log.open("a", encoding="utf-8") as log_file:
        while process.poll() is None:
            while True:
                try:
                    line = output_queue.get_nowait()
                except queue.Empty:
                    break
                log_file.write(f"{line}\n")
                buffered_lines.append(line)
            if buffered_lines:
                post_logs(job_id, buffered_lines)
                buffered_lines = []

            now = time.monotonic()
            if now >= next_control_check:
                next_control_check = now + CONTROL_SECONDS
                if stop_requested(job_id):
                    stopped = True
                    post_logs(job_id, ["Stop requested by control panel"])
                    terminate_process(process)
                    break

            time.sleep(0.2)

        reader.join(timeout=2)
        while True:
            try:
                line = output_queue.get_nowait()
            except queue.Empty:
                break
            log_file.write(f"{line}\n")
            buffered_lines.append(line)

    if buffered_lines:
        post_logs(job_id, buffered_lines)

    exit_code = process.returncode if process.returncode is not None else 143
    if stopped:
        post_logs(job_id, [f"Deployment stopped with exit code {exit_code}"])
        post_status(job_id, "stopped", 143)
    elif exit_code == 0:
        post_logs(job_id, ["Deployment finished successfully"])
        post_status(job_id, "success", exit_code)
    else:
        post_logs(job_id, [f"Deployment failed with exit code {exit_code}"])
        post_status(job_id, "failed", exit_code)


def claim_job() -> dict[str, Any] | None:
    run_id = uuid.uuid4().hex
    status_code, payload = api_request("/api/agent/jobs/claim/", {"agent_run_id": run_id})
    if status_code == 204:
        return None
    if not payload or "job" not in payload:
        raise AgentError(f"Unexpected claim response: {payload}")
    return payload["job"]


def main() -> int:
    require_config()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    next_log_cleanup = 0.0
    while True:
        try:
            now = time.monotonic()
            if LOG_CLEANUP_SECONDS > 0 and now >= next_log_cleanup:
                cleanup_old_logs()
                next_log_cleanup = now + LOG_CLEANUP_SECONDS
            api_request("/api/agent/ping/", {})
            job = claim_job()
            if job:
                run_job(job)
            else:
                time.sleep(POLL_SECONDS)
        except AgentError as exc:
            warn(str(exc))
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
