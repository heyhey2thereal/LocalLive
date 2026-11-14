# StreamControl — mémoire projet

Régie vidéo **Electron + React + TypeScript** pour sources RTMP, MediaMTX et
OBS Studio. Code en français, sans accents dans les identifiants ni les chaînes
de journal. Ce fichier indexe l'essentiel ; le détail des règles vit dans
`AGENTS.md` (à respecter) et `HANDOVER.md` (reprise de session).

## Dépôts et branches
- **Privé (développement)** : `heyhey2thereal/StreamControl-dev`.
- **Public (distribution)** : `heyhey2thereal/StreamControl` (historique Git
  indépendant, fichiers copiés par **liste blanche** ; jamais les binaires du
  privé, qui embarquent un `app-update.yml` pointant sur le privé).
- Branche de travail : **`v2.0.0`**. `main` est quasi vide : **ne rien y
  pousser**. Autres branches : `add-streamcontrol-app` (PR #1 non mergée),
  `fix/updater-public-ready`.
- Le code source n'est **pas** sur `main` ni dans le README : il vit sur la
  branche `v2.0.0` (et le tag du même nom).

## Cycle de release (pièges confirmés)
- Pousser un tag `v*` déclenche `.github/workflows/build-installers.yml`, qui
  compile les 3 installeurs et crée la Release. Pousser la **branche** ne
  rebuild rien : il faut **forcer le tag** (`git tag -f -a v2.0.0`, puis
  `git push --force refs/tags/v2.0.0:refs/tags/v2.0.0`).
- `v2.0.0` est **à la fois une branche et un tag** : pousser explicitement
  `refs/heads/...` et `refs/tags/...`, sinon « refspec matches more than one ».
- `scripts/changelog.mjs` **écrase `release-notes.md`** à chaque build de tag
  (il régénère depuis les commits, citant les commits internes). **Toujours
  reposer les notes rédigées après le build** via
  `PATCH /repos/.../releases/<id>`.
- **Course entre les 3 jobs** : ils joignaient tous `release-notes.md` à la
  Release ; l'un supprimait l'asset pendant qu'un autre faisait la même
  suppression → 404 et job Linux en échec. Corrigé : seule la plateforme
  `win32` joint ce fichier (`${{ matrix.platform == 'win32' && 'release-notes.md' || '' }}`).
- Vérifier que le binaire correspond au bon commit : lire l'entête de
  `build-log-win32.txt` joint à la Release (`commit : <sha>`).
- Le quota d'artefacts GitHub peut saturer : les deux `upload-artifact` sont en
  `continue-on-error: true`, il ne faut pas le retirer.

## Architecture (à ne pas casser)
- **MediaMTX est le seul serveur de flux.** StreamControl le pilote, relaie le
  HLS et le WebRTC, et sert ses propres pages. **Un seul point d'entrée** : les
  serveurs HTTP de MediaMTX écoutent sur `127.0.0.1` ; seuls le RTMP et le port
  des pages sont exposés.
- **NE JAMAIS modifier le pare-feu** (Norton ferme l'app). **NE PAS activer
  `authMethod: internal`** (rejette la caméra).
- `recordPath` de MediaMTX **doit** contenir `%path`, sinon l'API refuse (400).
- URL de **lecture** sur `127.0.0.1` (Windows bloque un poste vers sa propre
  adresse réseau) ; **ingestion** sur l'IPv4 du LAN.
- `contextIsolation` actif, `nodeIntegration` désactivé : toute fonctionnalité
  du rendu passe par un canal IPC déclaré dans `src/shared/channels.ts`, exposé
  dans `src/preload/index.ts`, implémenté dans `src/main/ipc.ts` — les trois
  restent synchronisés.
- Toute chaîne visible a une clé dans `src/shared/i18n.ts`, **dans les deux
  langues** (fr = référence). Un test refuse une clé manquante ou une élision
  sans apostrophe.

## StreamControl Remote (novembre 2026)
- Deux interfaces à la **même** adresse `/remote`, choisies **côté serveur**
  sur l'en-tête `User-Agent` (`describeDeviceKind`, `remote.ts`) :
  * **téléphone** → `renderRemotePage` (`remote-page.ts`), grands boutons ;
  * **ordinateur/tablette** → `renderRemoteDesktopPage`
    (`remote-desktop-page.ts`), grille de tous les flux + **enregistrement
    dans le navigateur** (`captureStream` + `MediaRecorder` → dossier
    Téléchargements de l'appareil, rien sur le poste).
  Ne pas décider sur la largeur d'écran : un PC en fenêtre étroite basculerait.
- **Autorisations** : `RemotePermissions` (5 droits : scenes, recording,
  download, macros, controls), réglées **séparément** pour `remote.phone` et
  `remote.desktop`. **Tout est refusé par défaut**
  (`sanitizeRemotePermissions` : seul `=== true` accorde). Relues **à chaque
  requête** → une case décochée prend effet sans réappairage. La page masque ce
  qui est refusé, **et le serveur le refuse aussi (403)** : masquer ne protège
  rien. UI : tableau de cases à cocher dans `RemoteView.tsx` (classe
  `.perm-table`).
- Le `kind` est enregistré à l'appairage (`RemoteDevice.kind`), pour que
  `/remote/state` renvoie les bonnes autorisations longtemps après.
- Ne **jamais reconstruire** la grille pendant un enregistrement : cela
  détacherait la vidéo et couperait la capture. Le rafraîchissement périodique
  ne met à jour que les badges, sauf changement d'autorisation ou de nombre de
  flux.

- Ne **jamais reconstruire** la grille des flux par `innerHTML` à chaque
  rafraîchissement : cela coupe la lecture et les enregistrements, et un flux
  nouvellement connecté n'apparaissait qu'après un rendu complet (l'utilisateur
  devait rafraîchir). La page PC **réconcilie** la grille : une carte par flux
  (clé `data-id`), créée/supprimée/mise à jour séparément, l'élément `<video>`
  n'étant jamais remplacé. Un seul écouteur de clic délégué sur `#app`.
- **Ne pas lancer tous les flux en même temps** : le décodeur du navigateur
  sature et met la lecture en pause tout seul (« pause automatique »). Lecture
  **à la demande** (`startPlayback`/`stopPlayback`), boutons « Lire »,
  « Tout lire », « Tout arreter ». L'état vit dans `playing[id] = { hls }`.
- **Retour au direct** : `hls.liveSyncPosition` pour sauter instantanément
  (rechargement de la session en secours). Présent sur les deux pages.
- **Piège récurrent** : un **backtick dans un commentaire** à l'intérieur d'un
  template literal de page ferme la chaîne (`TS1005: ';' expected`). Ne jamais
  écrire `\`mot\`` dans ces littéraux (ex. `captureStream`, `liveSyncPosition`) ;
  utiliser du texte nu.

## Tests et environnement
- **Les tests e2e chargent `dist/` (rendu React compilé par Vite) ET
  `dist-electron`.** Après une modification du rendu, `npm run build:electron`
  NE SUFFIT PAS : il faut `npm run build` (typecheck + Vite + tsc), sinon les
  e2e tournent sur l'ancien rendu et donnent des résultats trompeurs (un
  correctif d'interface paraît inopérant).
- `npm test` (39 unitaires) compile d'abord `dist-electron` : les tests
  importent le **code compilé**, donc `npm run build` avant.
- `npm run test:e2e` (479 vérifications) exige `xvfb-run`, un ffmpeg statique
  et un binaire MediaMTX (voir `HANDOVER.md`, à réinstaller chaque session :
  `/tmp` est vide). **Piege** : `pkill -f "mediamtx /tmp/"` avant de lancer.
- Nouveau test `tests/e2e/remote.mjs` (25/25) : deux interfaces, 403 sans
  autorisation, autorisation prise en compte à chaud, 401 sans jeton.
- Chiffres de référence : **41 unitaires · 479 e2e · 0 échec**.

## Enregistrements : tout en MP4 (`src/main/fmp4.ts`)
- MediaMTX en `fmp4` produit des `.mp4` **fragmentés** : chaque segment est un
  `ftyp`+`moov` puis `moof`+`mdat`, et **chaque fragment redémarre son `tfdt`
  (temps de décodage) à 0** avec le même `mfhd` (n° de séquence). Une mise bout à
  bout **brute** ne joue donc que le premier fragment (mesuré : 6 s de segments
  → 25 images / 1 s au lieu de 150 / 6 s).
- `concatFragmentedMp4` / `fmp4Append` gardent l'init du premier segment, puis
  réécrivent `mfhd` (séquence croissante) et `tfdt` (temps cumulé, calculé depuis
  `trun`/`tfhd`). Vérifié : 174 images, 6,96 s, décodage sans erreur.
- `replay.ts` (tampon) et `capture.ts` (capture) sont passés en fMP4 → `.mp4`.
  L'enregistrement direct (MediaMTX `fmp4`) produisait déjà des `.mp4`.
- Ne **jamais** recopier les segments fMP4 tels quels : passer par `fmp4.ts`.

## Replay (onglet dédié, 2.0.2)
- `ReplayView.tsx` : choix du flux + plage « de N à M secondes en arrière »
  (0 = dernière seconde). `replay:save` prend `{fromSeconds,toSeconds}` et
  renvoie `ReplayResult`. Mémoire (`replay.bufferSeconds`, 60 s), minimum
  (`replay.minimumSeconds`, 30 s) et `replay.outputPath` configurables.
  Un replay > mémoire ou < minimum est refusé. `replay:state` donne
  `{active, availableSeconds, ready}`.
- Le tampon MediaMTX est en fMP4 ; les segments sont assemblés par `fmp4.ts`.

## Dépôt public (distribution) — détails
- `main` = **1.0.0** ; les versions 2.x vivent sur des branches `V.2.0.x`
  (ex. `V.2.0.1`). Publier : branche `V.2.0.1` + tag `v2.0.1` (le tag déclenche
  le build et une Release **en brouillon**, `draft: true` dans le workflow
  public — à relire puis publier).
- Le README public est **curé** : titre `# StreamControl` (sans « RTMP »),
  mention « Windows, macOS et Linux », section « Composants tiers ». **Ne pas
  écraser avec le README du privé.**
- Publier en clonant le public (préserver son historique), puis remplacer les
  fichiers par **liste blanche** (`git archive` du privé, moins `AGENTS.md`,
  `HANDOVER.md`, `PUBLISHING.md`, `CHANGELOG-2.0.0.md`).

## Notes de session
- **11/11/2026 — correctifs 2.0.2 refaits, pousses, et tag `v2.0.2` reecrit.**
  Le workspace initial etait le **depot public** (`main` = 1.0.0) ; les 9
  fichiers « non committes » de la session precedente etaient **introuvables**
  (poste reprovisionne, pas de stash, pas d'objet orphelin). Correctifs
  **refaits** sur `StreamControl-dev` (branche `v2.0.0`, commit `ccc607a`,
  pousse) : duree reelle des segments (`fmp4SegmentSeconds`), replays en
  sous-dossier par flux, plein ecran distant stable, replay a la demande depuis
  un appareil. **43 unitaires · 491 e2e · 0 echec.** Detail : `2026-11-11.md`.
- **Public `V.2.0.2` refait** (commit `d81c123`) et **tag `v2.0.2` reecrit** :
  ancienne Release supprimee (`gh release delete v2.0.2 --cleanup-tag`), nouveau
  tag pousse sur `d81c123` -> CI relancee -> Release **publiee** (12 assets,
  `Latest`). Notes curees reposees (changelog.mjs les ecrase au build).
  **Piege** : `softprops/action-gh-release` a cree la Release **non associee**
  au tag (`untagged-...`) -> corriger via `PATCH /releases/<id>` `tag_name`.
- Détail de la session « Remote PC + autorisations » :
  `2026-11-08-remote-pc.md`.
- Un ancien fichier de mémoire appartenant à un **autre projet** (Made In
  Cambodge) traînait ici : conservé sous
  `2026-11-08-ancien-MadeInCambodge.md`.

## Session 13/11/2026 (2e) — replay casse (correctifs)
- **Cause 1 (duree fausse)** : `replay.ts:segmentDuration` ne lisait que
  256 Ko d'un segment et sommait les `trun` -> chaque segment de 2 s compte
  1,2 s. Corrige : `fmp4HeaderSeconds` (duree `mvhd`, exacte) lue en premier.
- **Cause 2 (apercu vide / pellicule muette)** : le serveur de pages ne
  renvoyait aucun `Access-Control-Allow-Origin`. Depuis Electron (`file://`),
  `fetch('/new')` et la video `crossOrigin` etaient bloques. Ajoute l'en-tete
  dans `handle()` (web-pages.ts).
- **Cause 3 (poignee bloquee a 12)** : `reachable = max(available, minimum)`
  forcait la poignee de debut au minimum des que la memoire etait courte.
  Corrige : `reachable = available`.
- **Cause 4 (duree fantome apres redemarrage)** : le tampon MediaMTX garde les
  segments de la publication precedente ; la duree annoncee les additionne.
  Corrige : purge a la reprise (`pruneReplayBufferBefore`, borne = instant de la
  deconnexion) et vidage du tampon au demarrage de l'app.
- **Chiffres apres correctifs : 52 unitaires · 529 e2e · 0 echec.** Correctifs
  pousses sur la branche `V.2.0.2` du depot public (voir aussi
  `CHANGELOG-2.0.2.md` section « 0 bis »).
- **Piege de diagnostic** : le tampon MediaMTX garde les segments des
  publications precedentes jusqu'a `recordDeleteAfter` ; un flux republie
  cumule donc la duree des deux sessions. Tester avec un flux neuf, ou vider.
