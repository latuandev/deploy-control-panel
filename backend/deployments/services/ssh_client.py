from __future__ import annotations

import json
import logging
import posixpath
import re
import shlex
import socket
import time
from dataclasses import dataclass
from typing import Any, Generator

import paramiko
from django.conf import settings

logger = logging.getLogger(__name__)

SAFE_TOKEN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$")
TERMINAL_STATUSES = {"success", "failed", "stopped", "unknown"}


class SSHClientError(Exception):
    pass


@dataclass(frozen=True)
class RemoteCommandResult:
    stdout: str
    stderr: str
    exit_code: int


class SSHClientService:
    def __init__(self) -> None:
        config = settings.TARGET_SSH
        self.host = config["HOST"]
        self.port = config["PORT"]
        self.user = config["USER"]
        self.key_path = config["KEY_PATH"]
        self.key_passphrase = config["KEY_PASSPHRASE"]
        self.known_hosts = config["KNOWN_HOSTS"]
        self.auto_add_host_key = config["AUTO_ADD_HOST_KEY"]
        self.remote_runner = config["REMOTE_RUNNER"]
        self.remote_log_dir = config["REMOTE_LOG_DIR"].rstrip("/")
        self.connect_timeout = config["CONNECT_TIMEOUT"]
        self.command_timeout = config["COMMAND_TIMEOUT"]
        self.stream_status_poll_seconds = config["STREAM_STATUS_POLL_SECONDS"]

    def run_command(self, command: str, timeout: int | None = None) -> RemoteCommandResult:
        with self._connect() as client:
            return self._run_command(client, command, timeout or self.command_timeout)

    def start_deploy_job(self, script_key: str) -> dict[str, Any]:
        self._validate_token(script_key, "script_key")
        result = self.run_command(
            f"{shlex.quote(self.remote_runner)} start {shlex.quote(script_key)}"
        )
        return self._json_result(result, "start deploy job")

    def get_remote_job_status(
        self,
        job_id: str,
        client: paramiko.SSHClient | None = None,
    ) -> dict[str, Any]:
        self._validate_token(job_id, "job_id")
        command = f"{shlex.quote(self.remote_runner)} status {shlex.quote(job_id)}"
        if client is not None:
            result = self._run_command(client, command, self.command_timeout)
        else:
            result = self.run_command(command)
        return self._json_result(result, "get remote job status")

    def stop_remote_job(self, job_id: str) -> dict[str, Any]:
        self._validate_token(job_id, "job_id")
        result = self.run_command(
            f"{shlex.quote(self.remote_runner)} stop {shlex.quote(job_id)}"
        )
        return self._json_result(result, "stop remote job")

    def stream_remote_log_file(
        self,
        log_file: str,
        job_id: str | None = None,
    ) -> Generator[dict[str, Any], None, None]:
        self._validate_log_file(log_file)
        if job_id:
            self._validate_token(job_id, "job_id")

        tail_command = f"tail -n +1 -F -- {shlex.quote(log_file)}"
        command = (
            "if command -v stdbuf >/dev/null 2>&1; then "
            f"exec stdbuf -oL -eL {tail_command}; "
            "else "
            f"exec {tail_command}; "
            "fi"
        )
        client = self._connect()
        channel = None
        try:
            transport = client.get_transport()
            if transport is None:
                raise SSHClientError("SSH transport is unavailable")
            channel = transport.open_session(timeout=self.connect_timeout)
            channel.exec_command(command)

            buffer = b""
            last_status_check = 0.0
            sent_terminal_status = False

            while True:
                while channel.recv_ready():
                    chunk = channel.recv(4096)
                    if not chunk:
                        break
                    buffer += chunk
                    parts = buffer.split(b"\n")
                    buffer = parts.pop()
                    for part in parts:
                        yield {
                            "event": "line",
                            "line": part.decode("utf-8", errors="replace").rstrip("\r"),
                        }

                now = time.monotonic()
                if job_id and now - last_status_check >= self.stream_status_poll_seconds:
                    last_status_check = now
                    status_payload = self.get_remote_job_status(job_id, client=client)
                    status = status_payload.get("status", "unknown")
                    if status in TERMINAL_STATUSES:
                        for event in self._drain_channel_lines(channel, buffer):
                            yield event
                            buffer = b""
                        yield {"event": "status", "payload": status_payload}
                        sent_terminal_status = True
                        break

                if channel.exit_status_ready():
                    if buffer:
                        yield {
                            "event": "line",
                            "line": buffer.decode("utf-8", errors="replace").rstrip("\r"),
                        }
                    if job_id and not sent_terminal_status:
                        yield {
                            "event": "status",
                            "payload": self.get_remote_job_status(job_id, client=client),
                        }
                    break

                time.sleep(0.25)
        except (paramiko.SSHException, socket.error, OSError) as exc:
            logger.exception("SSH log stream failed")
            raise SSHClientError(str(exc)) from exc
        finally:
            if channel is not None:
                channel.close()
            client.close()

    def _connect(self) -> paramiko.SSHClient:
        if not self.host:
            raise SSHClientError("TARGET_SSH_HOST is not configured")

        client = paramiko.SSHClient()
        try:
            if self.known_hosts:
                client.load_host_keys(self.known_hosts)
            else:
                client.load_system_host_keys()

            if self.auto_add_host_key:
                client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            else:
                client.set_missing_host_key_policy(paramiko.RejectPolicy())

            client.connect(
                hostname=self.host,
                port=self.port,
                username=self.user,
                key_filename=self.key_path,
                passphrase=self.key_passphrase,
                timeout=self.connect_timeout,
                banner_timeout=self.connect_timeout,
                auth_timeout=self.connect_timeout,
                look_for_keys=False,
                allow_agent=False,
            )
            transport = client.get_transport()
            if transport is not None:
                transport.set_keepalive(30)
            return client
        except (paramiko.SSHException, socket.error, OSError) as exc:
            client.close()
            logger.exception("SSH connection failed")
            raise SSHClientError(str(exc)) from exc

    def _run_command(
        self,
        client: paramiko.SSHClient,
        command: str,
        timeout: int,
    ) -> RemoteCommandResult:
        logger.info("Running remote command", extra={"command": command})
        transport = client.get_transport()
        if transport is None:
            raise SSHClientError("SSH transport is unavailable")

        channel = transport.open_session(timeout=self.connect_timeout)
        stdout_chunks: list[bytes] = []
        stderr_chunks: list[bytes] = []
        started = time.monotonic()
        try:
            channel.exec_command(command)
            while True:
                while channel.recv_ready():
                    stdout_chunks.append(channel.recv(4096))
                while channel.recv_stderr_ready():
                    stderr_chunks.append(channel.recv_stderr(4096))

                if channel.exit_status_ready():
                    break
                if time.monotonic() - started > timeout:
                    channel.close()
                    raise SSHClientError(f"Remote command timed out after {timeout}s")
                time.sleep(0.1)

            while channel.recv_ready():
                stdout_chunks.append(channel.recv(4096))
            while channel.recv_stderr_ready():
                stderr_chunks.append(channel.recv_stderr(4096))

            exit_code = channel.recv_exit_status()
            return RemoteCommandResult(
                stdout=b"".join(stdout_chunks).decode("utf-8", errors="replace"),
                stderr=b"".join(stderr_chunks).decode("utf-8", errors="replace"),
                exit_code=exit_code,
            )
        except (paramiko.SSHException, socket.error, OSError) as exc:
            logger.exception("Remote command failed")
            raise SSHClientError(str(exc)) from exc
        finally:
            channel.close()

    def _json_result(self, result: RemoteCommandResult, action: str) -> dict[str, Any]:
        if result.exit_code != 0:
            raise SSHClientError(
                f"Could not {action}: exit={result.exit_code}, stderr={result.stderr.strip()}, stdout={result.stdout.strip()}"
            )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise SSHClientError(
                f"Could not parse JSON from {action}: {result.stdout.strip()}"
            ) from exc
        if not isinstance(payload, dict):
            raise SSHClientError(f"Unexpected JSON payload from {action}")
        return payload

    def _validate_token(self, value: str, field_name: str) -> None:
        if not SAFE_TOKEN_RE.fullmatch(value):
            raise SSHClientError(f"Invalid {field_name}")

    def _validate_log_file(self, log_file: str) -> None:
        normalized_log_file = posixpath.normpath(log_file)
        normalized_log_dir = posixpath.normpath(self.remote_log_dir)
        if (
            not normalized_log_file.startswith(f"{normalized_log_dir}/")
            or normalized_log_file == normalized_log_dir
        ):
            raise SSHClientError("Log file is outside TARGET_REMOTE_LOG_DIR")

    def _drain_channel_lines(
        self,
        channel: paramiko.Channel,
        buffer: bytes,
    ) -> Generator[dict[str, Any], None, None]:
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            if not channel.recv_ready():
                time.sleep(0.05)
                continue
            buffer += channel.recv(4096)
            parts = buffer.split(b"\n")
            buffer = parts.pop()
            for part in parts:
                yield {
                    "event": "line",
                    "line": part.decode("utf-8", errors="replace").rstrip("\r"),
                }
        if buffer:
            yield {
                "event": "line",
                "line": buffer.decode("utf-8", errors="replace").rstrip("\r"),
            }
