#!/usr/bin/env bash
# LocalLive updater. Refreshes code and dependencies, rebuilds the frontend and
# restarts the service. User media and the database are never touched.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${SCRIPT_DIR}/scripts/common.sh"

require_root
print_banner
step_begin 6

if [[ ! -d "${APP_DIR}/backend" ]]; then
  die "Aucune installation trouvée dans ${APP_DIR}. Lancez d'abord install.sh."
fi

# ---------------------------------------------------------------------------
step_next "Sauvegarde de sécurité"
STAMP="$(date +%Y%m%d-%H%M%S)"
SAFETY="${BACKUP_DIR}/pre-update-${STAMP}"
install -d -m 0750 -o "${APP_USER}" -g "${APP_GROUP}" "${SAFETY}"
if [[ -f "${DATA_DIR}/locallive.db" ]]; then
  run_with_spinner "Sauvegarde de la base de données" \
    sqlite3 "${DATA_DIR}/locallive.db" ".backup '${SAFETY}/locallive.db'" 2>/dev/null \
    || cp -f "${DATA_DIR}/locallive.db" "${SAFETY}/locallive.db"
  log_ok "Base sauvegardée dans ${SAFETY}"
else
  log_warn "Aucune base à sauvegarder."
fi

# ---------------------------------------------------------------------------
step_next "Arrêt du service"
systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
log_ok "Service arrêté"

# ---------------------------------------------------------------------------
step_next "Mise à jour du code"
if [[ "${REPO_ROOT}" != "${APP_DIR}" ]]; then
  rm -rf "${APP_DIR}/backend" "${APP_DIR}/frontend/src" "${APP_DIR}/frontend/public"
  cp -a "${REPO_ROOT}/backend" "${APP_DIR}/" || die "Copie du backend impossible."
  cp -a "${REPO_ROOT}/frontend/." "${APP_DIR}/frontend/" || die "Copie du frontend impossible."
  cp -a "${REPO_ROOT}/scripts" "${APP_DIR}/" 2>/dev/null || true
  cp -f "${REPO_ROOT}/update.sh" "${REPO_ROOT}/backup.sh" "${REPO_ROOT}/uninstall.sh" "${APP_DIR}/" 2>/dev/null || true
  log_ok "Code mis à jour"
else
  log_warn "Le dépôt est déjà dans ${APP_DIR} — étape ignorée."
fi

# ---------------------------------------------------------------------------
step_next "Mise à jour des dépendances Python"
run_with_spinner "Installation des dépendances backend" \
  "${VENV_DIR}/bin/pip" install --quiet --upgrade pip \
  && "${VENV_DIR}/bin/pip" install --quiet -r "${APP_DIR}/backend/requirements.txt" \
  || die "Mise à jour des dépendances Python échouée."
log_ok "Dépendances Python à jour"

# ---------------------------------------------------------------------------
step_next "Recompilation de l'interface"
pushd "${APP_DIR}/frontend" >/dev/null || die "Répertoire frontend introuvable."
run_with_spinner "Installation npm" npm install --no-audit --no-fund --silent \
  || die "npm install a échoué."
run_with_spinner "Compilation du frontend" npm run build --silent \
  || die "Compilation du frontend échouée."
popd >/dev/null || true
log_ok "Interface recompilée"

# ---------------------------------------------------------------------------
step_next "Redémarrage du service"
chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}"
systemctl daemon-reload
systemctl start "${SERVICE_NAME}"
sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  log_ok "Service redémarré"
else
  log_error "Le service ne démarre pas — consultez : journalctl -u ${SERVICE_NAME} -n 50"
  exit 1
fi

IP="$(detect_primary_ip)"
printf "\n${C_GREEN}${C_BOLD}Mise à jour terminée.${C_RESET}\n"
printf "  Régie : ${C_AMBER}http://%s:%s${C_RESET}\n\n" "${IP}" "${APP_PORT}"
