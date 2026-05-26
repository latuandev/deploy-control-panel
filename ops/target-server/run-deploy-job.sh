#!/usr/bin/env bash
set -Eeuo pipefail

LOG_DIR="${DEPLOY_LOG_DIR:-/home/tuanle/logs/deploy}"

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  printf '%s' "$value"
}

json_string() {
  printf '"%s"' "$(json_escape "$1")"
}

iso_now() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

script_path_for_key() {
  case "$1" in
    coin-identifier)
      printf '%s\n' "/opt/scripts/deploy-coin-identifier.sh"
      ;;
    #hikoni)
    #  printf '%s\n' "/opt/scripts/deploy-hikoni.sh"
    #  ;;
    *)
      return 1
      ;;
  esac
}

validate_job_id() {
  [[ "${1:-}" =~ ^[0-9]{8}_[0-9]{6}_(coin-identifier|hikoni)$ ]]
}

write_status_file() {
  local job_id="$1"
  local status="$2"
  local exit_code="$3"
  local started_at="$4"
  local finished_at="$5"
  local log_file="$6"
  local status_file="$7"

  {
    printf '{"job_id":'
    json_string "$job_id"
    printf ',"status":'
    json_string "$status"
    printf ',"exit_code":'
    if [[ "$exit_code" == "null" ]]; then
      printf 'null'
    else
      printf '%s' "$exit_code"
    fi
    printf ',"started_at":'
    if [[ "$started_at" == "null" ]]; then
      printf 'null'
    else
      json_string "$started_at"
    fi
    printf ',"finished_at":'
    if [[ "$finished_at" == "null" ]]; then
      printf 'null'
    else
      json_string "$finished_at"
    fi
    printf ',"log_file":'
    json_string "$log_file"
    printf '}\n'
  } > "$status_file"
}

job_runner() {
  set +e

  local job_id="$1"
  local script_key="$2"
  local script_path="$3"
  local log_file="$4"
  local pid_file="$5"
  local status_file="$6"
  local started_at="$7"
  local child_pid=""

  terminate() {
    echo "[$(iso_now)] Stop requested for $job_id"
    if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
    fi
    write_status_file "$job_id" "stopped" "143" "$started_at" "$(iso_now)" "$log_file" "$status_file"
    rm -f "$pid_file"
    exit 143
  }

  trap terminate TERM INT

  echo "[$(iso_now)] Starting $script_key via $script_path"
  if command -v stdbuf >/dev/null 2>&1; then
    PYTHONUNBUFFERED=1 stdbuf -oL -eL "$script_path" &
  else
    PYTHONUNBUFFERED=1 "$script_path" &
  fi
  child_pid="$!"
  wait "$child_pid"
  local exit_code="$?"

  if [[ "$exit_code" -eq 0 ]]; then
    echo "[$(iso_now)] Deployment finished successfully"
    write_status_file "$job_id" "success" "$exit_code" "$started_at" "$(iso_now)" "$log_file" "$status_file"
  else
    echo "[$(iso_now)] Deployment failed with exit code $exit_code"
    write_status_file "$job_id" "failed" "$exit_code" "$started_at" "$(iso_now)" "$log_file" "$status_file"
  fi

  rm -f "$pid_file"
  exit "$exit_code"
}

error_json() {
  local message="$1"
  printf '{"error":'
  json_string "$message"
  printf '}\n'
}

start_job() {
  local script_key="${1:-}"
  local script_path

  if ! script_path="$(script_path_for_key "$script_key")"; then
    error_json "Invalid script key"
    exit 2
  fi

  if [[ ! -x "$script_path" ]]; then
    error_json "Script is not executable: $script_path"
    exit 3
  fi

  mkdir -p "$LOG_DIR"

  local existing_pid_file
  for existing_pid_file in "$LOG_DIR"/*_"$script_key".pid; do
    [[ -e "$existing_pid_file" ]] || continue
    local existing_pid
    existing_pid="$(cat "$existing_pid_file" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
      error_json "A job for this script is already running"
      exit 4
    fi
  done

  local timestamp
  timestamp="$(date -u +"%Y%m%d_%H%M%S")"
  local job_id="${timestamp}_${script_key}"
  local log_file="$LOG_DIR/$job_id.log"
  local pid_file="$LOG_DIR/$job_id.pid"
  local status_file="$LOG_DIR/$job_id.status"
  local started_at
  started_at="$(iso_now)"

  touch "$log_file"
  chmod 0640 "$log_file"
  write_status_file "$job_id" "running" "null" "$started_at" "null" "$log_file" "$status_file"

  nohup bash -c "$(declare -f iso_now json_escape json_string write_status_file job_runner); job_runner \"\$@\"" \
    _ "$job_id" "$script_key" "$script_path" "$log_file" "$pid_file" "$status_file" "$started_at" \
    >> "$log_file" 2>&1 &

  local pid="$!"
  printf '%s\n' "$pid" > "$pid_file"
  chmod 0640 "$pid_file" "$status_file"

  printf '{"job_id":'
  json_string "$job_id"
  printf ',"log_file":'
  json_string "$log_file"
  printf ',"pid_file":'
  json_string "$pid_file"
  printf ',"status_file":'
  json_string "$status_file"
  printf '}\n'
}

status_job() {
  local job_id="${1:-}"
  if ! validate_job_id "$job_id"; then
    error_json "Invalid job id"
    exit 2
  fi

  local log_file="$LOG_DIR/$job_id.log"
  local pid_file="$LOG_DIR/$job_id.pid"
  local status_file="$LOG_DIR/$job_id.status"

  if [[ -f "$status_file" ]]; then
    if grep -q '"status":"running"' "$status_file"; then
      local pid
      pid="$(cat "$pid_file" 2>/dev/null || true)"
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        cat "$status_file"
        return
      fi
      write_status_file "$job_id" "unknown" "null" "null" "$(iso_now)" "$log_file" "$status_file"
      cat "$status_file"
      return
    fi
    cat "$status_file"
    return
  fi

  write_status_file "$job_id" "unknown" "null" "null" "$(iso_now)" "$log_file" "$status_file"
  cat "$status_file"
}

stop_job() {
  local job_id="${1:-}"
  if ! validate_job_id "$job_id"; then
    error_json "Invalid job id"
    exit 2
  fi

  local log_file="$LOG_DIR/$job_id.log"
  local pid_file="$LOG_DIR/$job_id.pid"
  local status_file="$LOG_DIR/$job_id.status"
  local stopped=false

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
      stopped=true
    fi
  fi

  if [[ "$stopped" == true ]]; then
    if [[ ! -f "$status_file" ]] || ! grep -q '"status":"stopped"' "$status_file"; then
      write_status_file "$job_id" "stopped" "143" "null" "$(iso_now)" "$log_file" "$status_file"
    fi
    rm -f "$pid_file"
  fi

  printf '{"job_id":'
  json_string "$job_id"
  printf ',"stopped":%s}\n' "$stopped"
}

main() {
  local command="${1:-}"
  shift || true

  case "$command" in
    start)
      start_job "${1:-}"
      ;;
    status)
      status_job "${1:-}"
      ;;
    stop)
      stop_job "${1:-}"
      ;;
    *)
      error_json "Usage: run-deploy-job.sh start <script_key> | status <job_id> | stop <job_id>"
      exit 2
      ;;
  esac
}

main "$@"
