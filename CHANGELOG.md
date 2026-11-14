# Journal des versions

Le format suit [Semantic Versioning](https://semver.org/lang/fr/) :
`MAJEUR.MINEUR.CORRECTIF`. La version courante est dans le fichier `VERSION`.

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
