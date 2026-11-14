#!/usr/bin/env bash
# LocalLive uninstaller. Removes the service and application code. User data
# (media, database, backups) is only removed when explicitly requested.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${SCRIPT_DIR}/scripts/common.sh"

PURGE=0
for arg in "$@"; do
  case "${arg}" in
    --purge) PURGE=1 ;;
    -h|--help)
      cat <<EOF
Usage : sudo $0 [--purge]
  Sans option : supprime le service et le code, conserve les données.
  --purge     : supprime également la base, les médias, les journaux et les
                sauvegardes (définitif, une confirmation est demandée).
EOF
      exit 0 ;;
  esac
done

require_root
print_banner

log_step "Arrêt et suppression du service"
systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
log_ok "Service supprimé"

log_step "Suppression du code applicatif"
if [[ -d "${APP_DIR}" ]]; then
  rm -rf "${APP_DIR}"
  log_ok "Répertoire ${APP_DIR} supprimé"
fi
rm -f "${CONF_DIR}/locallive.env"
rmdir "${CONF_DIR}" 2>/dev/null || true

if [[ "${PURGE}" -eq 1 ]]; then
  log_step "Suppression définitive des données"
  log_warn "Cela supprime la base, les médias, les journaux et les sauvegardes."
  log_dim "Données concernées : ${DATA_DIR}, ${LOG_DIR}, ${BACKUP_DIR}"
  if confirm "Confirmer la suppression DÉFINITIVE de toutes les données ?"; then
    rm -rf "${DATA_DIR}" "${LOG_DIR}" "${BACKUP_DIR}"
    log_ok "Toutes les données ont été supprimées."
  else
    log_warn "Suppression des données annulée — elles restent dans ${DATA_DIR}."
  fi
else
  log_dim "Données conservées : ${DATA_DIR} (base, médias) et ${BACKUP_DIR}"
  log_dim "Pour tout supprimer : sudo $0 --purge"
fi

log_step "Suppression de l'utilisateur système"
if id "${APP_USER}" >/dev/null 2>&1; then
  if [[ "${PURGE}" -eq 1 ]]; then
    userdel "${APP_USER}" 2>/dev/null && log_ok "Utilisateur ${APP_USER} supprimé"
  else
    log_dim "Utilisateur ${APP_USER} conservé (données présentes)."
  fi
fi

printf "\n${C_GREEN}Désinstallation terminée.${C_RESET}\n\n"
