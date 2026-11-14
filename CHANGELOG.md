# Journal des versions

Le format suit [Semantic Versioning](https://semver.org/lang/fr/) :
`MAJEUR.MINEUR.CORRECTIF`. La version courante est dans le fichier `VERSION`.

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
