# LocalLive

**Régie de diffusion TV 24/7 auto-hébergée.**

LocalLive transforme un petit serveur Debian en chaîne de télévision continue.
Il diffuse en boucle des vidéos, de l'audio, des images et des scènes composées,
vers YouTube Live (RTMP) ou tout autre serveur compatible, et il continue de
diffuser même quand aucun navigateur n'est ouvert.

Conçu pour un hôte modeste : **2 cœurs Celeron, 8 Go de RAM, sans GPU**.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Première connexion](#première-connexion)
- [Utilisation](#utilisation)
- [Diffusion RTMP (YouTube Live)](#diffusion-rtmp-youtube-live)
- [Performance](#performance)
- [Maintenance](#maintenance)
- [Développement](#développement)
- [Tests](#tests)
- [Sécurité](#sécurité)
- [Dépannage](#dépannage)
- [Structure du projet](#structure-du-projet)

---

## Fonctionnalités

### Tableau de bord
- Aperçu vidéo en direct du programme en cours.
- Élément en cours, élément suivant, progression de la playlist.
- Commandes de diffusion : démarrer, arrêter, relancer.
- Surveillance **CPU, RAM, stockage** et état de la connexion RTMP.
- Journal du moteur FFmpeg en temps réel.

### Utilisateurs et permissions
- Trois rôles : **administrateur**, **opérateur**, **observateur**.
- Droits fins par utilisateur (consulter, média, playlists, scènes, diffusion,
  flux, programmation, utilisateurs, paramètres).
- Garde-fous : impossible de rétrograder ou supprimer le dernier administrateur.

### Médiathèque
- Import par **glisser-déposer** de vidéos, audio et images (multiple).
- Analyse automatique par **FFprobe** : durée, résolution, codecs, débit.
- **Vignettes** générées automatiquement, aperçu intégré.
- Recherche, filtres par type, **dossiers** et catégories.
- Renommage, suppression, métadonnées détaillées.
- Affichage de l'espace utilisé et de l'espace disque libre.

### Playlists
- Création et édition, ajout/retrait de médias et de scènes.
- **Réorganisation par glisser-déposer**, durées d'image configurables.
- **Transition d'entrée par élément** (coupe, fondu, balayage, cercle, zoom…).
- **Musique de fond par élément** : piste audio mixée sous l'élément, volume réglable.
- Bouton **Aperçu** par élément (vidéo/image).
- Lecture en boucle ou unique, progression automatique.

### Éditeur de scènes
- Canevas interactif : calques déplaçables, **8 poignées de redimensionnement**.
- **Magnétisme à la grille** (Maj), ratio verrouillé (Alt), flèches (1 / 10 px).
- **Menu déroulant recherchable** pour ajouter un calque, avec **aide intégrée**.
- Types de calques : **Texte, Image, Vidéo, Chat box, Code FFmpeg, URL web,
  Compte à rebours, Réactif, Logo, Bandeau**.
- **Animations IN / LOOP / OUT** combinables : fondu, glissements, zoom, pop,
  défilement, clignotement, pulsation, **tremblement**, flottement, rotation,
  respiration, couleurs.
- **Rotation**, opacité, ordre (z), visibilité, duplication, raccourcis (Ctrl+D,
  Suppr).
- **Chat box** : derniers messages d'une source, alimentés par
  `POST /api/chat/<source>` (voir l'aide du calque).
- **URL web** : image distante (png/jpg) récupérée par FFmpeg.
- La liste des scènes affiche un **mini-rendu** réel ; redimensionner un texte
  change sa taille ; les images ne débordent jamais du cadre.

### Aperçu / Programme
- Deux moniteurs **identiques côte à côte** : **Aperçu** (à gauche) et
  **Programme** (à droite), même taille et même ligne.
- **Flèche de transition** entre les deux : un clic met l'aperçu à l'antenne et
  fait basculer l'ancien programme dans l'aperçu. Si la diffusion est arrêtée,
  la prise d'antenne **démarre le direct** : aucune étape préalable.
- Choix de la **transition** (coupe, fondu, balayage…) sous les moniteurs.
- **Un seul bouton** pour mettre une playlist à l'antenne ; **contenu de
  l'aperçu** listé en bas (masquable).
- **Ouverture du rendu dans une fenêtre séparée** (moniteur déporté) avec
  **plein écran** et **son**.
- Le rendu se met à jour automatiquement quand la source change.

### Flux de sortie
- **Plusieurs destinations simultanées** (fan-out) : YouTube, Twitch, serveur perso…
- Par flux : nom, description, **étiquettes**, **confidentialité**, catégorie, encodage,
  résolution, débit, activation.
- **Test de connexion** RTMP et clé de flux **jamais exposée** (masquée).

### Programmation
- Programmes **quotidiens et hebdomadaires** (plages horaires récurrentes).
- Prise en charge des **plages nocturnes** (fin avant le début).
- **Bascule automatique** de playlist selon l'heure et le jour.
- **Playlist de secours** diffusée hors programme.

### Diffusion
- Moteur **FFmpeg** continu 24/7, indépendant du navigateur.
- Médias mixtes dans une même playlist (vidéo + image + audio + scène).
- **Fan-out multi-sorties** dans un seul processus (split/asplit, un encodage par sortie).
- Sortie **RTMP** (YouTube Live, Twitch, serveur perso) ou fichier local.
- Réglages : clé de flux, débit, résolution, images/s, préréglage.
- **Récupération automatique** après erreur de lecture.
- **Copie directe** (sans réencodage) quand les médias sont compatibles.

### Paramètres
- Chaîne (nom, fuseau, durée d'image), sécurité (mot de passe), journal serveur.
- **Bouton de mise à jour** : vérifie la dernière version publiée et l'applique
  en un clic. Le dépôt et la branche sont détectés à l'installation (dépôt cloné)
  et **jamais demandés** à l'opérateur.
- **Réinitialisation complète** avec **triple confirmation** (résumé, avertissement,
  saisie de « RESET ») : efface tout le contenu en conservant les comptes.

---

## Architecture

```
┌────────────────────┐        REST /api        ┌──────────────────────┐
│  Navigateur        │ ──────────────────────▶ │  FastAPI (Python)    │
│  React + TypeScript│ ◀────────────────────── │  SQLite + sessions   │
└────────────────────┘                         └──────────┬───────────┘
                                                          │ (indépendant)
                                              ┌───────────▼───────────┐
                                              │  Moteur FFmpeg 24/7    │
                                              │  superviseur + reprise │
                                              └───────────┬───────────┘
                                                          │
                                            ┌─────────────▼─────────────┐
                                            │  RTMP (YouTube Live…)     │
                                            └───────────────────────────┘
```

Le **moteur de diffusion est indépendant de l'interface web**. Il vit dans un
thread dédié du processus serveur, conserve son propre état et relance FFmpeg
automatiquement. Fermer le navigateur n'interrompt jamais le flux.

Deux pipelines sont choisis dynamiquement :

| Pipeline | Quand | Coût |
|----------|-------|------|
| **Copie directe** (`-c copy`) | Toutes les vidéos ont le même codec, la même résolution et le même fps, sans transition ni musique de fond | Presque nul (pas de réencodage) |
| **Encodage normalisé** (`-filter_complex`) | Médias mixtes, images, audio, scènes, transitions, musique de fond, fan-out | Réencodage x264 |

Le graphe d'encodage construit des **segments** normalisés (scale/pad/fps), les
assemble par **`concat`** (coupes franches) ou **`xfade`/`acrossfade`** (par
jonction, selon la transition de chaque élément), puis **`split`/`asplit`** vers
une sortie par flux actif. Les effets visuels (animations, visualiseurs,
transitions) sont décrits dans `backend/app/fx.py`.

---

## Prérequis

- **Debian 12 (bookworm)** ou plus récent.
- Un accès **root** (ou sudo).
- Connexion Internet pendant l'installation (paquets, npm).
- Pour YouTube Live : une clé de flux RTMP.
- Recommandé : 2 cœurs, 2 Go de RAM minimum, 10 Go d'espace libre.

---

## Installation

```bash
git clone <url-du-depot> locallive
cd locallive
sudo ./install.sh
```

Le script réalise, avec une animation de progression :

1. Vérification du système.
2. Installation des dépendances (Python, FFmpeg, Node.js/npm, polices).
3. Création de l'utilisateur système dédié `locallive`.
4. Préparation des répertoires (`/opt/locallive`, `/var/lib/locallive`).
5. Déploiement du code et installation des dépendances Python (venv).
6. **Compilation du frontend avec npm** (npm sert uniquement à la compilation).
7. Initialisation de la base SQLite.
8. Configuration du **service systemd** et démarrage automatique.
9. Détection de l'IP et affichage de l'URL d'accès.

**Le script est réexécutable sans risque.** Il détecte une installation
existante et conserve vos médias, playlists et réglages.

### Emplacements

| Élément | Chemin |
|---------|--------|
| Code applicatif | `/opt/locallive` |
| Base + médias | `/var/lib/locallive` |
| Journaux | `/var/lib/locallive/logs` |
| Configuration | `/etc/locallive/locallive.env` |
| Sauvegardes | `/var/backups/locallive` |
| Service | `locallive.service` |

---

## Première connexion

Ouvrez l'URL affichée en fin d'installation (`http://<ip>:8000`).

L'**assistant de configuration** se lance automatiquement :

1. **Vérification du système** — FFmpeg, FFprobe, stockage, matériel, Python.
2. **Compte administrateur** — nom d'utilisateur et mot de passe (8 caractères min.).
3. **Configuration de la chaîne** — nom et fuseau horaire.
4. **Accès au serveur** — détection des IP et de l'URL d'accès.
5. **Fin d'installation** — redirection vers la connexion.

Ensuite, connectez-vous. Toutes les pages sont protégées ; les actions
sensibles exigent le rôle administrateur.

---

## Utilisation

1. **Médiathèque** — importez vos vidéos, images et sons.
2. **Playlists** — composez l'ordre de passage et réglez les durées d'image.
3. **Scènes** *(optionnel)* — créez des habillages superposant textes et logos.
4. **Programmation** *(optionnel)* — planifiez vos plages et la playlist de secours.
5. **Paramètres** — renseignez l'URL RTMP et la clé de flux.
6. **Tableau de bord** — choisissez la playlist et cliquez sur **Démarrer**.

La diffusion continue indépendamment du navigateur.

---

## Diffusion RTMP (YouTube Live)

1. Dans YouTube Studio, créez un direct et récupérez **l'URL du serveur** et la
   **clé de flux**.
2. Dans LocalLive → **Paramètres** :
   - URL RTMP : `rtmp://a.rtmp.youtube.com/live2`
   - Clé de flux : votre clé (jamais affichée en clair ensuite).
3. Cliquez sur **Tester la connexion RTMP** (envoi de 2 s de mire).
4. Sur le tableau de bord, **Démarrez** la diffusion.

Pour tester sans plateforme, choisissez la sortie **Fichier local** dans les
paramètres et indiquez un chemin (`/tmp/live.ts`).

---

## Performance

Le moteur est optimisé pour un hôte sans GPU :

- **Copie directe** quand tous les médias partagent codec/résolution/fps → CPU quasi nul.
- **Aucun chargement de média en mémoire** : FFmpeg lit les fichiers en flux.
- **Aucune duplication ni conversion** des médias à l'import (analyse seule).
- Frontend léger : **~71 Ko gzippé** (pas de bibliothèque d'icônes externe).
- **Journalisation rotative** et nettoyage du fichier de concat temporaire.
- **Un seul service** : pas de conteneur Docker, pas de démon superflu.

### Preset basse consommation

Dans **Paramètres**, un bouton applique directement **480p / 25 i/s** :

```
854 × 480 · 25 i/s · 1200 kbps · préréglage veryfast
```

### Mesures réelles

Sur un hôte 2 cœurs (environnement de test) :

| Pipeline | CPU FFmpeg | RSS FFmpeg | Sortie |
|----------|-----------|------------|--------|
| Copie directe 720p | ~1 % | ~60 Mo | flux identique à la source |
| Encodage 480p | selon préréglage | ~60 Mo | 480p normalisé |

La consommation mémoire du moteur reste stable autour de 60 Mo : les médias ne
sont jamais chargés en RAM.

---

## Maintenance

```bash
# Mettre à jour (sauvegarde automatique de la base avant)
sudo ./update.sh

# Sauvegarder (base + config + médias)
sudo ./backup.sh
sudo ./backup.sh --no-media      # léger : base et config seulement
sudo ./backup.sh --keep=14       # conserver 14 sauvegardes

# Désinstaller
sudo ./uninstall.sh              # conserve les données
sudo ./uninstall.sh --purge      # supprime TOUT (confirmation demandée)

# Service
sudo systemctl status locallive
sudo systemctl restart locallive
journalctl -u locallive -f
```

---

## Développement

```bash
# Backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
cd backend && LOCALLIVE_DATA=../data uvicorn app.main:app --reload --port 8000

# Frontend (proxy vers l'API sur :8000)
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build        # produit frontend/dist servi par FastAPI en production
```

`LOCALLIVE_DATA` permet de choisir le répertoire de données (utile en
développement pour ne pas toucher aux données réelles).

---

## Tests

```bash
. .venv/bin/activate
pip install pytest httpx
cd backend && python -m pytest ../tests -q
```

La suite (**100 tests**) couvre : authentification et assistant, médiathèque
(import, analyse, vignettes, plages, dossiers), playlists et réordonnancement,
scènes (calques étendus, chat), programmation, diffusion (démarrage/arrêt,
réglages, masquage de la clé), métriques système, **effets** (transitions,
musique de fond, calques réactifs et code, fan-out), **flux de sortie** (CRUD,
validation, catalogue, aperçu/programme), **utilisateurs et permissions**
(rôles, droits, garde-fous), **réinitialisation**, **version/journal**, ainsi
que le **moteur FFmpeg réel** (copie directe, encodage mixte, transitions,
boucle, récupération). Les tests génèrent leurs propres médias avec FFmpeg.

---

## Sécurité

- Mots de passe **hachés avec scrypt** (memory-hard), jamais stockés en clair.
- **Sessions** par jeton aléatoire 256 bits ; seul un condensé SHA-256 est stocké.
- Cookie de session **httpOnly**, SameSite=Lax.
- **Limitation** des tentatives de connexion (anti-force brute).
- **Clé de flux jamais exposée** : masquée dans toutes les réponses de l'API.
- Contrôle des rôles : les routes d'écriture exigent un administrateur.
- Validation stricte des entrées (Pydantic) sur toutes les routes.
- Chemins de fichiers contrôlés, noms assainis à l'import.
- Service systemd durci (`ProtectSystem=strict`, `NoNewPrivileges`, etc.).
- Aucun message d'erreur ne divulgue d'information sensible.

> **Important** : placez LocalLive derrière un reverse proxy **HTTPS**
> (nginx, Caddy) si vous l'exposez hors de votre réseau local.

---

## Dépannage

**Le service ne démarre pas**
```bash
journalctl -u locallive -n 60
```
Vérifiez que le port 8000 est libre et que `/var/lib/locallive` est accessible
par l'utilisateur `locallive`.

**FFmpeg absent**
```bash
sudo apt-get install -y ffmpeg
sudo systemctl restart locallive
```

**La connexion RTMP échoue**
- Vérifiez l'URL et la clé de flux.
- Vérifiez que le port 1935 sortant n'est pas bloqué.
- Utilisez le bouton **Tester la connexion RTMP**.

**La diffusion est lente / saccadée**
- Activez le preset **480p / 25 i/s**.
- Réduisez le débit vidéo.
- Privilégiez la **copie directe** en uniformisant vos sources (même codec,
  résolution et fps).

**L'interface affiche « Frontend non compilé »**
```bash
cd /opt/locallive/frontend && sudo -u locallive npm run build
sudo systemctl restart locallive
```

---

## Structure du projet

```
LocalLive/
├── install.sh            # Installateur (animation, système, systemd)
├── update.sh             # Mise à jour (sauvegarde préalable)
├── backup.sh             # Sauvegarde base + médias
├── uninstall.sh          # Désinstallation (--purge pour tout effacer)
├── VERSION
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── main.py       # Application FastAPI, service du frontend
│       ├── config.py     # Chemins et réglages
│       ├── db.py         # Schéma et accès SQLite
│       ├── security.py   # Hachage scrypt, sessions
│       ├── deps.py       # Dépendances (auth, admin, installé)
│       ├── monitor.py    # CPU / RAM / disque via /proc
│       ├── probe.py      # FFprobe et vignettes
│       ├── engine.py     # Moteur de diffusion FFmpeg 24/7 (xfade, fan-out)
│       ├── fx.py         # Effets : animations, visualiseurs, transitions
│       ├── permissions.py # Rôles et capacités
│       ├── logging_setup.py
│       └── routers/      # setup, auth, media, folders, playlists, scenes,
│                         # streams, schedules, broadcast, users, meta, system
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx, App.tsx, api.ts, auth.tsx, i18n.ts, styles.css
│       ├── lib/          # usePoll (polling sans chevauchement)
│       ├── components/   # Layout, Logo, SceneCanvas, ProgramPreview, ui, icons
│       └── pages/        # SetupWizard, Login, Dashboard, PreviewProgram,
│                         # ProgramWindow, Streams, MediaLibrary, Playlists,
│                         # Scenes, Scheduling, Users, Settings
├── CHANGELOG.md          # Journal des versions
├── scripts/common.sh     # Helpers des scripts (couleurs, spinners)
└── tests/                # pytest : auth, média, playlists, effets,
                          # flux, moteur, diffusion
```

---

## Licence

Projet original. Les composants tiers (FFmpeg, FastAPI, React, etc.) conservent
leurs licences respectives.
