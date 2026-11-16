#!/usr/bin/env bash
# LocalLive backup. Creates a timestamped archive of the database, settings and
# (optionally) the media library. Media can be large — use --no-media to skip it.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${SCRIPT_DIR}/scripts/common.sh"

INCLUDE_MEDIA=1
KEEP=7
for arg in "$@"; do
  case "${arg}" in
    --no-media) INCLUDE_MEDIA=0 ;;
    --keep=*) KEEP="${arg#*=}" ;;
    -h|--help)
      cat <<EOF
Usage : sudo $0 [options]
  --no-media   Sauvegarde uniquement la base et la configuration (léger).
  --keep=N     Conserve les N dernières sauvegardes (défaut : ${KEEP}).
EOF
      exit 0 ;;
  esac
done

require_root
print_banner

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${BACKUP_DIR}/locallive-${STAMP}"
install -d -m 0750 "${DEST}"

log_step "Sauvegarde de la base de données"
if [[ -f "${DATA_DIR}/locallive.db" ]]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "${DATA_DIR}/locallive.db" ".backup '${DEST}/locallive.db'" \
      && log_ok "Base copiée (cohérente)"
  else
    cp -f "${DATA_DIR}/locallive.db" "${DEST}/locallive.db"
    log_ok "Base copiée"
  fi
else
  log_warn "Aucune base trouvée."
fi

log_step "Sauvegarde de la configuration"
[[ -f "${CONF_DIR}/locallive.env" ]] && cp -f "${CONF_DIR}/locallive.env" "${DEST}/" 2>/dev/null
log_ok "Configuration incluse"

if [[ "${INCLUDE_MEDIA}" -eq 1 ]]; then
  log_step "Sauvegarde de la médiathèque"
  if [[ -d "${DATA_DIR}/media" ]]; then
    tar -czf "${DEST}/media.tar.gz" -C "${DATA_DIR}" media thumbs 2>/dev/null \
      && log_ok "Médias archivés ($(du -sh "${DEST}/media.tar.gz" 2>/dev/null | cut -f1))" \
      || log_warn "L'archivage des médias a échoué."
  else
    log_warn "Aucune médiathèque trouvée."
  fi
else
  log_dim "Médias exclus (--no-media)."
fi

# Write a small manifest for traceability.
{
  echo "LocalLive backup"
  echo "date=$(date -Iseconds)"
  echo "host=$(hostname)"
  echo "version=$(cat "${APP_DIR}/VERSION" 2>/dev/null || echo '1.0.0')"
  echo "include_media=${INCLUDE_MEDIA}"
} >"${DEST}/MANIFEST"

chmod -R go-rwx "${DEST}"
chown -R "${APP_USER}:${APP_GROUP}" "${DEST}" 2>/dev/null || true

# Retention
mapfile -t OLD < <(ls -1dt "${BACKUP_DIR}"/locallive-* 2>/dev/null | tail -n +$((KEEP + 1)))
if [[ ${#OLD[@]} -gt 0 ]]; then
  log_step "Nettoyage des anciennes sauvegardes (conservation : ${KEEP})"
  for d in "${OLD[@]}"; do
    rm -rf "${d}" && log_dim "Supprimé : ${d}"
  done
fi

log_step "Sauvegarde terminée"
log_ok "Emplacement : ${DEST}"
du -sh "${DEST}" 2>/dev/null | awk '{print "  Taille totale : " $1}'
