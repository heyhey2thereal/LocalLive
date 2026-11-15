#!/usr/bin/env bash
# LocalLive installer for Debian 12 (bookworm) and later.
#
# Safe to re-run: it never deletes user media or the database. Existing data is
# detected and preserved; upgrades only refresh code, dependencies and service.

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/common.sh
source "${SCRIPT_DIR}/scripts/common.sh"

require_root
print_banner
step_begin 9

# ---------------------------------------------------------------------------
# 0. Pre-flight checks
# ---------------------------------------------------------------------------
step_next "Vérification du système"

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  log_info "Système détecté : ${PRETTY_NAME:-inconnu}"
  if [[ "${ID:-}" != "debian" && "${ID_LIKE:-}" != *"debian"* ]]; then
    log_warn "Ce script cible Debian. L'installation peut échouer sur ${ID:-ce système}."
    confirm "Continuer malgré tout ?" || exit 1
  fi
else
  log_warn "/etc/os-release introuvable — impossible de confirmer la distribution."
fi

for tool in apt-get systemctl; do
  command -v "${tool}" >/dev/null 2>&1 || die "${tool} est requis."
done

if [[ -d "${DATA_DIR}" && -f "${DATA_DIR}/locallive.db" ]]; then
  REINSTALL=1
  log_warn "Une installation existante a été détectée dans ${DATA_DIR}."
  log_dim "Vos médias, playlists et réglages seront conservés."
else
  REINSTALL=0
fi

# ---------------------------------------------------------------------------
# 1. System dependencies
# ---------------------------------------------------------------------------
step_next "Installation des dépendances système"
run_with_spinner "Mise à jour de la liste des paquets" \
  env DEBIAN_FRONTEND=noninteractive apt-get update -qq || die "apt-get update a échoué."

# sqlite3 backs up the database safely (online .backup, WAL-aware); gnupg is
# required by the NodeSource repository script on a minimal Debian container;
# sudo is required for the restricted self-update rule ("Mettre à jour").
PKGS=(python3 python3-venv python3-pip ffmpeg curl ca-certificates fonts-dejavu-core sqlite3 gnupg sudo)
run_with_spinner "Installation de Python, FFmpeg et outils" \
  env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${PKGS[@]}" \
  || die "L'installation des paquets système a échoué."

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1 \
   || [[ "$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')" -lt 18 ]]; then
  log_info "Node.js 18+ absent — installation depuis NodeSource."
  run_with_spinner "Ajout du dépôt NodeSource" bash -c \
    "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -" \
    || die "Impossible d'ajouter le dépôt NodeSource (vérifiez l'accès réseau)."
  run_with_spinner "Installation de Node.js et npm" \
    env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs \
    || die "L'installation de Node.js a échoué."
else
  log_ok "Node.js déjà présent ($(node -v))"
fi

log_ok "FFmpeg : $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f1-3)"
log_ok "Python : $(python3 --version)"

# ---------------------------------------------------------------------------
# 2. Dedicated user
# ---------------------------------------------------------------------------
step_next "Création de l'utilisateur dédié"

if id "${APP_USER}" >/dev/null 2>&1; then
  log_ok "L'utilisateur ${APP_USER} existe déjà"
else
  useradd --system --home-dir "${APP_DIR}" --shell /usr/sbin/nologin \
    --user-group "${APP_USER}" \
    && log_ok "Utilisateur système ${APP_USER} créé" \
    || die "Impossible de créer l'utilisateur ${APP_USER}."
fi

# ---------------------------------------------------------------------------
# 3. Directories
# ---------------------------------------------------------------------------
step_next "Préparation des répertoires"

install -d -m 0755 -o "${APP_USER}" -g "${APP_GROUP}" "${APP_DIR}"
install -d -m 0750 -o "${APP_USER}" -g "${APP_GROUP}" "${DATA_DIR}"
install -d -m 0750 -o "${APP_USER}" -g "${APP_GROUP}" "${LOG_DIR}"
install -d -m 0755 "${CONF_DIR}"
install -d -m 0750 -o "${APP_USER}" -g "${APP_GROUP}" "${BACKUP_DIR}"
log_ok "Répertoires prêts (données : ${DATA_DIR})"

# ---------------------------------------------------------------------------
# 4. Application files
# ---------------------------------------------------------------------------
step_next "Déploiement de l'application"

if [[ -d "${APP_DIR}/backend" && "${REINSTALL}" -eq 1 ]]; then
  # Preserve data; only refresh code. Media lives in DATA_DIR, never in APP_DIR.
  rm -rf "${APP_DIR}/backend" "${APP_DIR}/frontend/src" "${APP_DIR}/frontend/public"
fi

cp -a "${REPO_ROOT}/backend" "${APP_DIR}/" || die "Copie du backend impossible."
install -d -m 0755 "${APP_DIR}/frontend"
cp -a "${REPO_ROOT}/frontend/." "${APP_DIR}/frontend/" || die "Copie du frontend impossible."
cp -a "${REPO_ROOT}/scripts" "${APP_DIR}/" 2>/dev/null || true
cp -f "${REPO_ROOT}/update.sh" "${REPO_ROOT}/backup.sh" "${REPO_ROOT}/uninstall.sh" "${APP_DIR}/" 2>/dev/null || true
cp -f "${REPO_ROOT}/CHANGELOG.md" "${REPO_ROOT}/VERSION" "${APP_DIR}/" 2>/dev/null || true
chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}"
log_ok "Code applicatif installé dans ${APP_DIR}"

# ---------------------------------------------------------------------------
# 5. Python virtual environment
# ---------------------------------------------------------------------------
step_next "Installation des dépendances Python"

if [[ ! -d "${VENV_DIR}" ]]; then
  run_with_spinner "Création de l'environnement virtuel" \
    python3 -m venv "${VENV_DIR}" || die "Création du venv impossible."
fi
run_with_spinner "Installation des paquets Python" \
  "${VENV_DIR}/bin/pip" install --quiet --upgrade pip \
  || die "Mise à jour de pip impossible."
run_with_spinner "Installation des dépendances backend" \
  "${VENV_DIR}/bin/pip" install --quiet -r "${APP_DIR}/backend/requirements.txt" \
  || die "L'installation des dépendances Python a échoué."
chown -R "${APP_USER}:${APP_GROUP}" "${VENV_DIR}"
log_ok "Environnement Python prêt"

# ---------------------------------------------------------------------------
# 6. Frontend build (npm used only for building — no dev server in production)
# ---------------------------------------------------------------------------
step_next "Compilation de l'interface"

pushd "${APP_DIR}/frontend" >/dev/null || die "Répertoire frontend introuvable."
run_with_spinner "Installation des dépendances npm" \
  npm install --no-audit --no-fund --silent || die "npm install a échoué."
run_with_spinner "Compilation du frontend" \
  npm run build --silent || die "La compilation du frontend a échoué."
popd >/dev/null || true
chown -R "${APP_USER}:${APP_GROUP}" "${APP_DIR}/frontend/dist"
log_ok "Interface compilée dans frontend/dist"

# ---------------------------------------------------------------------------
# 7. Database initialisation
# ---------------------------------------------------------------------------
step_next "Initialisation de la base de données"

run_with_spinner "Préparation de la base SQLite" \
  env LOCALLIVE_DATA="${DATA_DIR}" "${VENV_DIR}/bin/python" -c \
  "import sys; sys.path.insert(0, '${APP_DIR}/backend'); from app import db; db.init_db()" \
  || die "L'initialisation de la base a échoué."
chown -R "${APP_USER}:${APP_GROUP}" "${DATA_DIR}"
log_ok "Base de données prête : ${DATA_DIR}/locallive.db"

# ---------------------------------------------------------------------------
# 8. Configuration file
# ---------------------------------------------------------------------------
# The update source (git repository + branch) is detected from the clone this
# installer is run from, so the operator is never asked for it: the interface
# just offers a single "Mettre à jour" button. UPDATE_REPO / UPDATE_BRANCH may
# still be passed explicitly to override the detection.
if [[ -z "${UPDATE_REPO:-}" ]]; then
  UPDATE_REPO="$(git -C "${REPO_ROOT}" remote get-url origin 2>/dev/null || true)"
fi
if [[ -z "${UPDATE_BRANCH:-}" ]]; then
  UPDATE_BRANCH="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
UPDATE_BRANCH="${UPDATE_BRANCH:-main}"
if [[ -n "${UPDATE_REPO}" ]]; then
  log_ok "Source de mise à jour détectée : ${UPDATE_REPO} (branche ${UPDATE_BRANCH})"
else
  log_warn "Dépôt git introuvable : la mise à jour depuis l'interface sera indisponible."
fi

if [[ ! -f "${CONF_DIR}/locallive.env" ]]; then
  cat >"${CONF_DIR}/locallive.env" <<EOF
# LocalLive — configuration de service
LOCALLIVE_DATA=${DATA_DIR}
LOCALLIVE_FRONTEND=${APP_DIR}/frontend/dist
LOCALLIVE_HOST=${APP_HOST}
LOCALLIVE_PORT=${APP_PORT}
# Mise à jour depuis l'interface : dépôt git et branche à suivre (détectés à
# l'installation depuis le dépôt cloné ; jamais demandés à l'opérateur).
LOCALLIVE_UPDATE_REPO=${UPDATE_REPO}
LOCALLIVE_UPDATE_BRANCH=${UPDATE_BRANCH}
EOF
  # The service runs as APP_USER, so the file must be readable by APP_GROUP:
  # root:APP_GROUP with mode 0640 (readable by the service, not world-readable).
  chown "root:${APP_GROUP}" "${CONF_DIR}/locallive.env"
  chmod 0640 "${CONF_DIR}/locallive.env"
  log_ok "Fichier de configuration créé : ${CONF_DIR}/locallive.env"
else
  # Refresh the update source on re-run so it follows the current clone.
  if grep -q '^LOCALLIVE_UPDATE_REPO=' "${CONF_DIR}/locallive.env"; then
    sed -i "s|^LOCALLIVE_UPDATE_REPO=.*|LOCALLIVE_UPDATE_REPO=${UPDATE_REPO}|" "${CONF_DIR}/locallive.env"
    sed -i "s|^LOCALLIVE_UPDATE_BRANCH=.*|LOCALLIVE_UPDATE_BRANCH=${UPDATE_BRANCH}|" "${CONF_DIR}/locallive.env"
  else
    {
      echo "LOCALLIVE_UPDATE_REPO=${UPDATE_REPO}"
      echo "LOCALLIVE_UPDATE_BRANCH=${UPDATE_BRANCH}"
    } >>"${CONF_DIR}/locallive.env"
  fi
  # Repair ownership/permissions on re-run so an existing file stays readable.
  chown "root:${APP_GROUP}" "${CONF_DIR}/locallive.env" 2>/dev/null || true
  chmod 0640 "${CONF_DIR}/locallive.env" 2>/dev/null || true
  log_ok "Fichier de configuration conservé"
fi

# Self-update helper: a small root-owned script the service user may run through
# sudo, so the "Mettre à jour" button can actually pull the latest code.
install -d -m 0755 /usr/local/sbin
install -m 0755 "${REPO_ROOT}/scripts/locallive-update" /usr/local/sbin/locallive-update
cat >"/etc/sudoers.d/locallive-update" <<EOF
# Allow the LocalLive service user to run the updater without a password.
${APP_USER} ALL=(root) NOPASSWD: /usr/local/sbin/locallive-update
EOF
chmod 0440 "/etc/sudoers.d/locallive-update"
log_ok "Programme de mise à jour installé (/usr/local/sbin/locallive-update)"

# Tell the application which command to run for updates, and seed the update
# source (repo + branch) so the interface needs no configuration at all.
env LOCALLIVE_DATA="${DATA_DIR}" "${VENV_DIR}/bin/python" -c \
  "import sys; sys.path.insert(0, '${APP_DIR}/backend'); from app import db; db.set_setting('update_command', 'sudo /usr/local/sbin/locallive-update'); db.set_setting('update_repo', '${UPDATE_REPO}'); db.set_setting('update_branch', '${UPDATE_BRANCH}')" \
  2>/dev/null || true

# ---------------------------------------------------------------------------
# 9. systemd service
# ---------------------------------------------------------------------------
step_next "Configuration du service systemd"

cat >"/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=${APP_NAME} — régie de diffusion TV 24/7
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${CONF_DIR}/locallive.env
Environment=PYTHONUNBUFFERED=1
ExecStart=${VENV_DIR}/bin/uvicorn app.main:app --host \${LOCALLIVE_HOST} --port \${LOCALLIVE_PORT} --workers 1
Restart=always
RestartSec=3
# Hardening (the engine needs no privileges and no writable system paths).
# NOTE: NoNewPrivileges is deliberately NOT set. The service user runs the
# self-updater through a restricted sudoers rule ("Mettre à jour" button);
# NoNewPrivileges would stop the setuid `sudo` binary from gaining root, so the
# update could never run. The sudoers rule is narrowly scoped to the updater.
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR} ${LOG_DIR} ${APP_DIR}/frontend/dist
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
systemctl restart "${SERVICE_NAME}"

# Verify the service actually came up instead of assuming success.
sleep 3
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  log_ok "Service ${SERVICE_NAME} activé et démarré"
else
  log_error "Le service ${SERVICE_NAME} ne démarre pas."
  log_dim "Dernières lignes du journal :"
  journalctl -u "${SERVICE_NAME}" -n 15 --no-pager 2>/dev/null | sed 's/^/    /' || true
  if journalctl -u "${SERVICE_NAME}" -n 40 --no-pager 2>/dev/null | grep -qi "namespace\|ProtectSystem\|PrivateTmp\|mount"; then
    log_warn "Cause probable : durcissement systemd non supporté par ce conteneur LXC."
    log_dim "Correctif : retirez les lignes ProtectSystem / ProtectHome / PrivateTmp de"
    log_dim "/etc/systemd/system/${SERVICE_NAME}.service puis relancez :"
    log_dim "  systemctl daemon-reload && systemctl restart ${SERVICE_NAME}"
  fi
  die "Installation interrompue : le service n'a pas démarré."
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
IP="$(detect_primary_ip)"
printf "\n${C_GREEN}${C_BOLD}╭─────────────────────────────────────────────╮${C_RESET}\n"
printf "${C_GREEN}${C_BOLD}│   Installation terminée avec succès         │${C_RESET}\n"
printf "${C_GREEN}${C_BOLD}╰─────────────────────────────────────────────╯${C_RESET}\n\n"
printf "  ${C_BOLD}Accès à la régie :${C_RESET}  ${C_AMBER}http://%s:%s${C_RESET}\n" "${IP}" "${APP_PORT}"
printf "  ${C_BOLD}Service :${C_RESET}          %s\n" "$(systemctl is-active ${SERVICE_NAME} 2>/dev/null || echo inconnu)"
printf "  ${C_BOLD}Données :${C_RESET}          %s\n" "${DATA_DIR}"
printf "  ${C_BOLD}Journaux :${C_RESET}         journalctl -u %s -f\n\n" "${SERVICE_NAME}"
printf "  ${C_DIM}Ouvrez l'adresse ci-dessus pour lancer l'assistant de configuration.${C_RESET}\n\n"
