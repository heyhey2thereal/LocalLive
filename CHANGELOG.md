# Journal des versions

Le format suit [Semantic Versioning](https://semver.org/lang/fr/) :
`MAJEUR.MINEUR.CORRECTIF`. La version courante est dans le fichier `VERSION`.

## [2.12.0] — 2026-11-15

### Ajouté
- **Son du moniteur** : un bouton haut-parleur sur le moniteur d'aperçu permet
  d'écouter la bande son (musique de fond, vidéo, piste audio). Le son est joué
  par un **élément audio unique hors interface** : il **continue en arrière-plan**
  quand on change de page et ne s'arrête que si on le coupe explicitement.
- **Compte à rebours pilotable** : quand un calque compte à rebours est détecté
  sur l'élément à l'antenne ou dans l'aperçu, des commandes apparaissent sous le
  moniteur — **relancer** le décompte et **ajouter du temps** (+10 s / +30 s /
  +60 s). L'ajout de temps modifie la valeur de départ de la scène ; si l'élément
  est à l'antenne il redémarre aussitôt pour afficher le nouveau temps.
  `POST /api/broadcast/countdown` (`item_id`, `action` = `add` | `restart`,
  `seconds`).

### Corrigé
- **Animation « Couleurs » (rainbow) dans l'interface** : le texte change
  maintenant de couleur (l'ancien `filter: hue-rotate` ne modifiait pas un texte
  blanc). Les teintes suivent celles du moteur (`fx.RAINBOW_COLORS`).
- **Éléments hors cadre** : en édition, un calque peut sortir du cadre (le cadre
  n'est qu'un repère). Déplacer ou redimensionner un élément au-delà des bords
  est possible et l'élément reste attrapable. Les moniteurs continuent de
  découper proprement ce qui part à l'antenne.
- **Cadre au survol** : survoler un élément affiche son contour.
- **Aperçu des animations** : survoler un élément joue ses animations **une
  seule fois** (aperçu), et l'élément sélectionné ne les joue plus (il reste
  immobile pour être édité).
- **Prise d'antenne sans direct** : la flèche aperçu → programme ne **démarre
  plus** le direct et n'affiche plus de message « il faut que le stream soit
  allumé ». Si le direct est arrêté, la prise d'antenne ne fait rien (sans
  erreur) ; `POST /api/broadcast/take` renvoie `{"ok": true, "switched": false}`.

## [2.11.0] — 2026-11-14

### Corrigé
- **Mise à jour en un clic, sans configuration** : plus aucune commande à
  enregistrer. Si le réglage `update_command` est vide, l'application utilise
  automatiquement le programme standard `/usr/local/sbin/locallive-update`
  installé par `install.sh`.
- **Animation « Couleurs » (rainbow)** : elle fait maintenant défiler la couleur
  du **texte** lui-même (et non plus un cadre autour). `fontcolor_expr`
  n'évaluant pas les expressions sur toutes les versions de FFmpeg, le texte est
  dessiné une fois par couleur, chacune activée à tour de rôle (`fx.rainbow_enable`).
- **Polices** : la police choisie sur un calque est appliquée dans l'éditeur et
  dans les moniteurs, et chaque nom dans le sélecteur s'affiche **dans sa propre
  police** (`frontend/src/lib/fonts.ts`).

### Ajouté
- **Avis de mise à jour** : après une mise à jour réussie, un petit message
  (« Application mise à jour vers la version X ») s'affiche **une seule fois** à
  la prochaine ouverture de l'interface (`GET /api/system/update-notice`).

## [2.10.0] — 2026-11-14

### Corrigé
- **Prise d'antenne** : la flèche (aperçu → programme) ne **démarre plus** le
  direct. Si le direct est arrêté, la prise d'antenne est refusée et il faut
  cliquer sur « Démarrer le direct ». `POST /api/broadcast/take` ne lance plus
  le moteur.
- **Compte à rebours** : plus de **fond noir** par défaut (il ne reste que si on
  le demande explicitement).
- **Défilement (marquee)** : le texte traverse le cadre **une seule fois** (fini
  l'effet « spam » qui recommençait en boucle).
- **Animation « Couleurs » (rainbow)** : elle fait défiler la couleur d'un
  **cadre** autour de l'élément — le **texte** n'est plus recoloré.
- **Polices** : un sélecteur de police apparaît sur les calques texte/bandeau
  (par défaut, sans, sans gras, serif, serif gras, monospace, monospace gras…).
  Seules les polices réellement installées sont proposées.
- **Compte à rebours synchronisé** : l'aperçu ne prend plus d'avance sur le
  programme — le décompte du programme suit le temps réel de diffusion, celui de
  l'aperçu reste figé sur la valeur de départ.

### Ajouté
- **Minuteur de direct** : durée écoulée affichée sur le moniteur Programme et
  sur le Tableau de bord (« Depuis 1h 23m », heure de début).

## [2.9.0] — 2026-11-14

### Corrigé
- **Durée d'une scène dans une playlist** : l'API renvoyait `0` pour un élément
  de type scène alors que le moteur joue la durée d'image par défaut — la
  playlist affichait une durée fausse. Elle renvoie désormais la durée réelle.
- **Réglages d'un élément écrasés** : modifier la transition (ou la musique de
  fond) via `PATCH` remettait la **durée** à 0. Le `PATCH` ne touche plus que
  les champs réellement envoyés.
- **Fichiers d'aperçu orphelins** : supprimer un média (ou tout réinitialiser)
  laissait les aperçus mis en cache (`previews/{id}-*.jpg`). Ils sont maintenant
  nettoyés.

### Ajouté
- **Sauvegarde / restauration de la configuration** (Paramètres) : export d'un
  fichier **JSON** (scènes, playlists, flux, programmes, dossiers, réglages —
  sans les médias) et import additif. Utile pour cloner un poste ou archiver.
- **Suppression groupée de médias** : cases de sélection sur les cartes, barre
  d'action, suppression de plusieurs médias en un clic (`/api/media/bulk-delete`).
- **Recherche** sur les pages **Scènes** et **Playlists** (filtre instantané).
- **Éléments de playlist** : boutons **▲ / ▼** pour monter/descendre un élément
  sans glisser-déposer, et **Dupliquer** un élément (copie juste après, avec ses
  réglages).
- **Statistiques de contenu** sur le Tableau de bord : nombre de médias (taille et
  durée cumulée), scènes, playlists, flux (dont actifs), programmes, utilisateurs
  (`/api/system/stats`).

## [2.8.0] — 2026-11-14

### Ajouté
- **Calque Horloge** : affiche l'heure et/ou la date en direct (formats prêts :
  heure 24h/12h, date, jour + mois). Rendu par FFmpeg (`%{localtime}`), mis à
  jour à chaque image, sans rechargement. Option UTC.
- **Calque Bandeau d'actualités (RSS)** : bandeau défilant alimenté par un flux
  **RSS ou Atom**. Les titres sont récupérés et **mis en cache 5 minutes** côté
  serveur (module `feeds.py`, sans dépendance), puis défilent (animation LOOP).
  Un bouton **Tester** dans l'éditeur affiche les premiers titres.
- **Passage manuel** : boutons **⏮ / ⏭** dans Aperçu / Programme pour passer à
  l'élément précédent/suivant sans attendre la fin (`POST /api/broadcast/next`,
  `/previous`).
- **Raccourcis clavier** dans Aperçu / Programme : **Espace** = prise d'antenne,
  **← / →** = élément précédent/suivant, **?** = aide (nouvelle fenêtre d'aide).
- **Mise à l'antenne rapide** (Tableau de bord) : une bande de scènes ; un clic
  crée la playlist, y place la scène et démarre le direct vers la sortie
  principale.
- **Duplication** : d'une **scène** (bouton sur la carte) et d'une **playlist**
  (bouton dans l'en-tête), copie complète des calques / éléments.
- **Médiathèque** : tri (plus récents, nom, taille, durée) en plus de la
  recherche et des filtres existants.

### Corrigé
- **Horloge** : `%{localtime:%H:%M}` était rejeté par FFmpeg (les `:` internes
  sont des séparateurs d'arguments) ; chaque directive est désormais expandue
  séparément (`%{localtime\:%H}\:%{localtime\:%M}`).

## [2.7.0] — 2026-11-14

### Corrigé
- **Étirement d'image** : une image redimensionnée remplit désormais toute sa
  boîte (étirement), à l'écran comme à l'antenne : tirer un bord étire l'image
  de ce côté, plus de bandes noires.
- **Image hors cadre inutilisable** : le redimensionnement est borné au cadre
  (le bord tiré reste où on le pose, l'image ne peut plus dépasser), et une
  scène plus ancienne est recadrée à l'ouverture — les poignées restent toujours
  atteignables.
- **Animations de transition** : l'effet joue sur la **fenêtre** du moniteur
  (voile, balayage, cercle…) et non sur son contenu — la vidéo continue de jouer
  pendant la bascule.

### Ajouté
- **Aperçu des animations de calque** : choisir une animation (entrée, boucle,
  sortie) la montre immédiatement sur le calque dans l'éditeur, et dans les
  moniteurs **Aperçu** et **Programme**.
- **Choix du flux de sortie au démarrage** : la fenêtre de confirmation du
  direct propose la **sortie principale**, un **flux précis** ou **tous les
  flux activés**.

## [2.6.1] — 2026-11-14

### Corrigé
- **Mise en programme sans direct** : la flèche de prise d'antenne (Aperçu /
  Programme) démarre la diffusion toute seule quand elle est arrêtée — plus
  besoin de « Démarrer le direct » avant de mettre une playlist au programme.
- **Vignette de scène partout** : chaque endroit où l'on choisit une scène
  (sélecteur d'ajout à une playlist, lignes de playlist, aperçu d'un élément)
  affiche désormais un **rendu réel de la scène** au lieu d'un carré vide.

### Modifié
- **Mise à jour sans configuration** : l'interface ne demande plus le **dépôt**
  ni la **branche**. `install.sh` les détecte dans le dépôt cloné (URL du remote
  et branche courante) et les enregistre côté serveur ; l'opérateur n'a plus
  qu'un bouton **« Mettre à jour »**.

## [2.6.0] — 2026-11-14

### Corrigé
- **Débordement des images** : chaque calque est toujours dimensionné et borné au
  cadre ; le rendu de l'aperçu remplit exactement sa fenêtre (`FitScene` mesuré) —
  la fenêtre programme ne bouge plus.
- **Suppression de scène** : le bouton de la carte est maintenant toujours
  cliquable (au-dessus de l'aperçu) et un bouton « Supprimer » est ajouté dans
  l'éditeur.
- **Fluidité** : le déplacement/redimensionnement est limité à une mise à jour par
  image (`requestAnimationFrame`) — plus de saccades.
- **Countdown** : horloge MM:SS vivante dans l'aperçu (et expression FFmpeg
  fiabilisée).
- **Sélection de texte** désactivée partout (sauf champs, code, erreurs) ; les
  images ne sont plus glissables.
- **Mise à jour réellement fonctionnelle** : `scripts/locallive-update` +
  règle sudoers posés par `install.sh` ; l'interface configure le dépôt et la
  branche, vérifie s'il y a une mise à jour et l'applique.

### Modifié
- Aperçu / Programme : le bouton « Mettre à l'antenne » est retiré (la flèche
  suffit) ; la bascule **ne démarre plus** le direct ; des **popups de
  confirmation** encadrent le démarrage et l'arrêt du direct.

## [2.5.0] — 2026-11-14

### Corrigé
- **Débordement des images** hors du cadre : chaque calque a désormais une taille
  explicite (hauteur déduite du ratio du média), donc rien ne dépasse plus.
- **Suppression de scène** : fonctionne (confirmation puis suppression).
- **Transitions** : un effet visuel réel est joué sur les moniteurs à la prise
  d'antenne (fondu, glissement, voile, cercle, zoom, flou).
- **Latence** : l'aperçu et le programme se rafraîchissent toutes les secondes.
- **Chargement des images** : aperçu 960 px pré-généré à l'import et mis en cache
  (en-tête `Cache-Control`), affichage quasi instantané.
- **Compte à rebours** : format MM:SS, sans fond noir, démarre à la mise à
  l'antenne (le temps part de l'arrivée sur le programme).

### Ajouté
- Bouton **« Étendre »** sur les images : remplit automatiquement tout le cadre de
  la scène.
- **Plein écran avec son** sur le programme (l'audio s'active au clic).
- Bouton **démarrer/arrêter le direct** sur Aperçu / Programme.

### Modifié
- **Menu réordonné** : Tableau de bord, Aperçu / Programme, Scènes, Playlists,
  Flux de sortie, Programmation, Bibliothèque.
- Les boutons démarrer/arrêter sont retirés du Tableau de bord (renvoi vers
  Aperçu / Programme).

## [2.4.0] — 2026-11-14

### Refonte
- **Aperçu / Programme entièrement repensé** : deux moniteurs identiques côte à
  côte (même taille, même ligne), une **flèche de transition** entre les deux qui
  effectue la bascule (le programme devient l'aperçu et inversement), sélecteur de
  transition dessous, **un seul bouton** pour mettre une playlist à l'antenne, et
  le contenu de l'aperçu listé en bas.

### Corrigé
- **Débordement des images** hors du cadre dans les scènes : les calques sont
  désormais bornés au cadre (plus de débordement en bas).
- **Images lentes à charger** : aperçus JPEG 960 px mis en cache
  (`/api/media/{id}/preview`), utilisés par l'éditeur et l'aperçu.
- **Mise à jour** : le bouton indique clairement quand une action serveur est
  nécessaire (`update.sh`) au lieu de simuler un succès.

### Ajouté
- **Guides intelligents type Canva** dans l'éditeur de scènes (bords et centres),
  désactivés en maintenant **Maj**.
- **Plein écran** d'une image/vidéo depuis l'éditeur.
- **Flou** (gblur) réglable par calque.

## [2.3.0] — 2026-11-14

### Ajouté
- Éditeur de calques enrichi : **Texte, Image, Vidéo, Chat box, Code FFmpeg,
  URL web, Compte à rebours, Réactif, Logo, Bandeau**, avec **menu déroulant
  recherchable** et **aide intégrée** par type.
- **Animations IN / LOOP / OUT** : entrée (fondu, glissements, zoom, pop),
  boucle (défilement, clignotement, pulsation, tremblement, flottement,
  rotation, respiration, couleurs), sortie (fondu, glissements, zoom arrière).
- **Ajout de source type OBS** dans Aperçu/Programme (scène ou média en un clic).
- **Plein écran** sur les tuiles image/vidéo ; fenêtre déportée plein écran + son.

### Corrigé
- La mise à jour n'est proposée que si la version publiée est **réellement plus
  récente** (comparaison SemVer).
- Un calque **image ne déborde plus** du cadre (mise à l'échelle + pad).
- **Chargement rapide** des images (vignette pour les petits rendus, pleine
  résolution pour les grands).
- Aperçu à **gauche**, Programme à **droite** (alignés).

### Modifié
- Tableau de bord : « playlist à diffuser » retiré (renvoi vers Aperçu/Programme).
- Bouton de déconnexion retravaillé (avatar + rôle + icône).
- UI **responsive** : barre latérale repliable, grilles adaptatives.
- Paramètres : mise à jour et réinitialisation (triple confirmation).

## [2.2.0] — 2026-11-14

### Ajouté
- **Réinitialisation complète** (Paramètres) avec triple confirmation : efface
  médias, playlists, scènes, flux, dossiers et programmation ; conserve les
  comptes utilisateurs.
- **Bouton de mise à jour** dans les Paramètres : vérifie la dernière version
  publiée, animation de chargement, puis redémarrage (via `update_command`).
- Calque de scène **chat box** (source + nombre de lignes), alimenté par
  `/api/chat/{source}`.
- **Aperçu live** : le rendu se met à jour quand la source change.
- **Fenêtre déportée** : plein écran et son activable.
- Gestion des sources (playlists, scènes, médias) regroupée dans Aperçu/Programme.

### Corrigé
- L'**agrandissement du texte** change bien la taille de police (le texte grandit
  avec la boîte).
- **Étirer une image** ne la pixellise plus : le rendu utilise le flux pleine
  résolution au lieu de la vignette.
- La liste des scènes affiche un **mini-rendu réel** au lieu d'une icône.

### Modifié
- **Menu réordonné** : diffusion, puis contenu, puis configuration.

## [2.1.0] — 2026-11-14

### Ajouté
- Gestion des **utilisateurs et permissions** : rôles administrateur, opérateur et
  observateur, plus des droits fins par utilisateur.
- **Switcher Aperçu / Programme** (style OBS) : deux moniteurs côte à côte,
  choix de transition, prise d'antenne, ouverture du rendu dans une fenêtre.
- **Flux de sortie** multiples (fan-out RTMP) avec métadonnées et test de connexion.
- **Transitions** par élément de playlist et **musique de fond** mixée.
- Calques de scène **réactifs** (spectre, oscilloscope, barres, vectorscope) et
  **code FFmpeg** personnalisé, **animations** (défilement, compte à rebours,
  clignotement, pulsation, fondu, glissement), **rotation**.
- Cache 30 s du calcul de taille des médias.

### Modifié
- Éditeur de scène : redimensionnement fiable, canevas qui tient dans la fenêtre.
- Paramètres : la configuration RTMP est déplacée vers la page « Flux de sortie ».

## [2.0.0] — 2026-11-14

### Ajouté
- Table `streams`, migrations `playlist_items`, module d'effets `fx.py`.
- Moteur refondu (segments, transitions, musique, fan-out).

## [1.0.0] — 2026-11-14

Version initiale : médiathèque, playlists, scènes, programmation, moteur FFmpeg
24/7, diffusion RTMP, installation Debian/systemd.
