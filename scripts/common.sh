#!/usr/bin/env bash
# Shared helpers for the LocalLive management scripts: colours, progress
# indicators, logging and safe prompts. Sourced by install/update/backup/uninstall.

set -uo pipefail

# ---------------------------------------------------------------------------
# Colours (disabled when not a TTY or when NO_COLOR is set)
# ---------------------------------------------------------------------------
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[38;5;203m'; C_GREEN=$'\033[38;5;114m'
  C_YELLOW=$'\033[38;5;221m'; C_BLUE=$'\033[38;5;111m'
  C_AMBER=$'\033[38;5;215m'; C_GREY=$'\033[38;5;245m'
else
  C_RESET=''; C_BOLD=''; C_DIM=''; C_RED=''; C_GREEN=''
  C_YELLOW=''; C_BLUE=''; C_AMBER=''; C_GREY=''
fi

# ---------------------------------------------------------------------------
# Configuration (overridable via environment)
# ---------------------------------------------------------------------------
APP_NAME="${APP_NAME:-LocalLive}"
APP_USER="${APP_USER:-locallive}"
APP_GROUP="${APP_GROUP:-locallive}"
APP_DIR="${APP_DIR:-/opt/locallive}"
DATA_DIR="${DATA_DIR:-/var/lib/locallive}"
LOG_DIR="${LOG_DIR:-/var/log/locallive}"
CONF_DIR="${CONF_DIR:-/etc/locallive}"
SERVICE_NAME="${SERVICE_NAME:-locallive}"
APP_PORT="${APP_PORT:-8000}"
APP_HOST="${APP_HOST:-0.0.0.0}"
# shellcheck disable=SC2034  # used by sourcing scripts
VENV_DIR="${APP_DIR}/venv"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/locallive}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC2034  # used by sourcing scripts
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SPINNER_PID=""
STEP_TOTAL=0
STEP_CURRENT=0

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log_info()    { printf "  %s\n" "$*"; }
log_ok()      { printf "  ${C_GREEN}✓${C_RESET} %s\n" "$*"; }
log_warn()    { printf "  ${C_YELLOW}!${C_RESET} %s\n" "$*"; }
log_error()   { printf "  ${C_RED}✗${C_RESET} %s\n" "$*" >&2; }
log_step()    { printf "\n${C_BOLD}${C_AMBER}▸ %s${C_RESET}\n" "$*"; }
log_dim()     { printf "  ${C_GREY}%s${C_RESET}\n" "$*"; }

die() { log_error "$*"; exit 1; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Ce script doit être exécuté en root (essayez : sudo $0)"
  fi
}

# ---------------------------------------------------------------------------
# Spinner — shows a live animation while a long command runs
# ---------------------------------------------------------------------------
_spinner() {
  local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local i=0
  while :; do
    printf "\r  ${C_BLUE}%s${C_RESET} ${C_DIM}%s${C_RESET}" "${frames[$i]}" "${1}"
    i=$(( (i + 1) % ${#frames[@]} ))
    sleep 0.08
  done
}

start_spinner() {
  [[ -t 1 ]] || { log_dim "$1"; return 0; }
  _spinner "$1" &
  SPINNER_PID=$!
}

stop_spinner() {
  local status="${1:-0}"
  local message="${2:-}"
  if [[ -n "${SPINNER_PID}" ]]; then
    kill "${SPINNER_PID}" 2>/dev/null
    wait "${SPINNER_PID}" 2>/dev/null
    SPINNER_PID=""
    printf "\r\033[K"
  fi
  if [[ -n "${message}" ]]; then
    if [[ "${status}" -eq 0 ]]; then log_ok "${message}"; else log_error "${message}"; fi
  fi
}

# Run a command with a spinner; capture output to a log file for error reporting.
run_with_spinner() {
  local message="$1"; shift
  local logfile
  logfile="$(mktemp)"
  start_spinner "${message}"
  if "$@" >"${logfile}" 2>&1; then
    stop_spinner 0 "${message}"
    rm -f "${logfile}"
    return 0
  else
    local code=$?
    stop_spinner 1 "${message}"
    log_dim "Détails de l'erreur :"
    sed 's/^/    /' "${logfile}" | tail -n 20
    rm -f "${logfile}"
    return "${code}"
  fi
}

# ---------------------------------------------------------------------------
# Progress steps (X / N)
# ---------------------------------------------------------------------------
step_begin() { STEP_TOTAL="$1"; STEP_CURRENT=0; }
step_next() {
  STEP_CURRENT=$((STEP_CURRENT + 1))
  printf "\n${C_BOLD}${C_AMBER}[%d/%d]${C_RESET} ${C_BOLD}%s${C_RESET}\n" \
    "${STEP_CURRENT}" "${STEP_TOTAL}" "$1"
}

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
confirm() {
  local prompt="${1:-Continuer ?}" answer
  if [[ ! -t 0 ]]; then return 0; fi
  read -r -p "  ${C_YELLOW}?${C_RESET} ${prompt} [o/N] " answer
  [[ "${answer,,}" == "o" || "${answer,,}" == "y" ]]
}

detect_primary_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[0-9.]+' | head -1)"
  fi
  if [[ -z "${ip}" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "${ip:-127.0.0.1}"
}

print_banner() {
  printf "\n${C_AMBER}"
  cat <<'BANNER'
   __         __        __    _
  / /  ___   / /  ___  / /   (_) _   __ ___
 / /  / _ \ / /  / __)/ /   / / | | / // _ \
/ /__/  __// /__/ /__ / /___/ /  | |/ //  __/
\____/\___/\____/\___/\____/_/   |___/ \___/
BANNER
  printf "${C_RESET}"
  printf "  ${C_GREY}%s — Régie de diffusion TV 24/7${C_RESET}\n" "${APP_NAME}"
}
