# Journal des versions

Le format suit [Semantic Versioning](https://semver.org/lang/fr/) :
`MAJEUR.MINEUR.CORRECTIF`. La version courante est dans le fichier `VERSION`.

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
