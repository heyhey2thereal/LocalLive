// FAQ: a searchable list of frequently asked questions, grouped by theme.
//
// Written for the operator of the channel: how to hear the programme, how to get
// sound and text to YouTube, how to build a playlist, etc. Answers stay short and
// concrete; a search box filters by question or answer text.

import { useMemo, useState } from 'react'
import { IconSearch } from '../components/icons'

interface QA {
  q: string
  a: string
}

interface Section {
  title: string
  items: QA[]
}

const SECTIONS: Section[] = [
  {
    title: 'Le son',
    items: [
      {
        q: 'Comment entendre le son de mon programme ?',
        a: "Le son se règle depuis le bouton haut-parleur du moniteur PROGRAMME (page Aperçu / Programme). Il est activé par défaut. Une fois activé, il continue en arrière-plan : il est seulement coupé (sourdine) quand vous quittez la page et revient aussitôt que vous revenez, sans redémarrer.",
      },
      {
        q: 'Pourquoi le son ne redémarre-t-il pas quand je coupe puis réactive ?',
        a: "Couper le son est une sourdine, pas un arrêt : la lecture continue en arrière-plan et reprend exactement où elle en était. L'icône barrée indique simplement que le son est coupé.",
      },
      {
        q: 'Comment écouter la musique de la playlist dans l’aperçu ?',
        a: "En bas de la page Aperçu / Programme se trouve une console de son : elle affiche le titre en cours, un visuel et une barre de progression. Glissez la barre pour reculer ou avancer.",
      },
      {
        q: 'La console de son suit-elle le direct ?',
        a: "Oui. Quand la diffusion est active, la barre affiche la position réelle du programme (par exemple 10 s si la musique du direct en est à 10 s). Mettre en pause met aussi le direct en pause ; reprendre repart exactement où il s'était arrêté.",
      },
      {
        q: 'Pourquoi je n’entends rien dans mon navigateur ?',
        a: "Les navigateurs bloquent la lecture automatique avec son tant que vous n'avez pas interagi avec la page. Cliquez une fois n'importe où (ou sur le bouton haut-parleur) pour autoriser le son.",
      },
    ],
  },
  {
    title: 'Diffusion vers YouTube (RTMP)',
    items: [
      {
        q: 'Comment envoyer le son et le texte à YouTube ?',
        a: "Le moteur FFmpeg envoie déjà le son (musique de fond, vidéo, pistes audio) ET les textes/scènes dans le flux RTMP. Configurez la destination dans l'onglet Flux de sortie, puis démarrez le direct depuis Aperçu / Programme.",
      },
      {
        q: 'Le texte des scènes part-il à l’antenne ?',
        a: "Oui : les calques texte, horloge, compte à rebours, bandeau RSS et les images sont dessinés dans le flux (drawtext / overlay). Ce que vous voyez dans le moniteur Programme correspond à ce qui part sur YouTube.",
      },
      {
        q: 'Comment tester la connexion RTMP ?',
        a: "Dans Flux de sortie, cliquez sur « Tester » à côté du flux : un court handshake est envoyé vers la destination et le résultat s'affiche.",
      },
      {
        q: 'Où se configurent l’URL et la clé de flux ?',
        a: "Dans l'onglet Flux de sortie (destinations RTMP), ou dans les paramètres de diffusion pour la sortie principale. La clé n'est jamais réaffichée en clair : seule une version masquée est affichée.",
      },
    ],
  },
  {
    title: 'Aperçu / Programme',
    items: [
      {
        q: 'À quoi servent les deux moniteurs ?',
        a: "APERÇU montre ce que vous préparez, PROGRAMME ce qui est à l'antenne. La flèche entre les deux bascule l'aperçu vers le programme (prise d'antenne).",
      },
      {
        q: 'La prise d’antenne démarre-t-elle le direct ?',
        a: "Non. Elle bascule seulement le programme. Si le direct est arrêté, le programme est quand même mis à jour mais rien n'est diffusé : cliquez sur « Démarrer le direct » pour diffuser.",
      },
      {
        q: 'Comment passer à l’élément suivant ?',
        a: "Utilisez les boutons ⏮ / ⏭ sous les moniteurs, ou les flèches ← → du clavier (Espace prend l'antenne).",
      },
      {
        q: 'Puis-je choisir un élément précis de l’aperçu ?',
        a: "Oui : cliquez sur une ligne dans « Contenu de l'aperçu » pour l'afficher dans le moniteur d'aperçu, puis prenez l'antenne quand vous êtes prêt.",
      },
    ],
  },
  {
    title: 'Playlists et scènes',
    items: [
      {
        q: 'Comment ajouter une scène à une playlist ?',
        a: "Onglet Playlists, ouvrez une playlist puis « Ajouter » : choisissez un média ou une scène. Réglez la durée en secondes à droite de chaque élément.",
      },
      {
        q: 'Pourquoi ma scène de 5 s ne s’enchaîne-t-elle pas ?',
        a: "Vérifiez la durée de l'élément (5 s) : le moteur enchaîne automatiquement sur l'élément suivant. Dans l'aperçu, le moniteur défile aussi dans la playlist selon ces durées.",
      },
      {
        q: 'Comment continuer la musique d’un élément sur le suivant ?',
        a: "Dans les réglages d'un élément (bouton transition/musique), cochez « Continuer la musique précédente ». L'élément garde alors la piste de l'élément du dessus au lieu d'en démarrer une autre.",
      },
      {
        q: 'Comment faire une transition entre deux éléments ?',
        a: "Ouvrez les réglages d'un élément et choisissez une « Transition d'entrée » (fondu, balayage, cercle…). Elle s'applique à la jonction avec l'élément précédent.",
      },
      {
        q: 'Mes modifications de playlist sont-elles prises en compte en direct ?',
        a: "Oui. Si la playlist modifiée est celle qui est à l'antenne, le moteur la recharge aussitôt et reprend au même élément. Les autres playlists (et l'aperçu) ne sont pas touchés.",
      },
      {
        q: 'L’aperçu continue-t-il quand je quitte la page ?',
        a: "Oui. Le défilement de l'aperçu (passage d'une scène à l'autre selon leur durée) continue en arrière-plan, comme la musique. En revenant sur la page, l'aperçu reprend sur l'élément qui devrait être en cours, il ne repart pas du premier.",
      },
      {
        q: 'La programmation bascule-t-elle vraiment la playlist toute seule ?',
        a: "Oui, pendant le direct. À l'heure et au jour d'un programme, le moteur bascule automatiquement la playlist à l'antenne. À l'arrêt du direct, la programmation ne touche pas au programme que vous préparez.",
      },
    ],
  },
  {
    title: 'Calques et animations',
    items: [
      {
        q: 'Comment sortir un élément du cadre ?',
        a: "Glissez-le au-delà des bords : il reste sélectionnable, mais il est découpé (croppé) au cadre, exactement comme à l'antenne. Rien ne déborde jamais de la scène.",
      },
      {
        q: 'Comment mettre une image dans un cadre rond ou arrondi ?',
        a: "Sur un calque image ou logo, choisissez un « Cadre » (rectangle, coins arrondis, rond, ovale, losange, triangle, hexagone), puis réglez l'épaisseur et la couleur de la bordure.",
      },
      {
        q: 'Comment animer un texte au rythme de la musique ?',
        a: "Choisissez l'animation de boucle « Réactif à la musique », puis réglez la « Sensibilité à la musique » : plus la valeur est haute, plus le calque réagit fort.",
      },
      {
        q: 'Comment faire grossir une image au rythme de la musique ?',
        a: "Sur un calque Image (ou Logo/Vidéo), choisissez l'animation de boucle « Réactif à la musique » : l'image grandit quand la musique monte et rétrécit quand elle baisse. La sensibilité règle l'amplitude. À l'antenne, le moteur mesure le volume réel de la musique de fond de l'élément (ou le son de la vidéo).",
      },
      {
        q: 'Mon spectre (calque « Réactif ») était tout noir, pourquoi ?',
        a: "L'axe des fréquences était linéaire : presque toute l'énergie musicale tenait dans une fine bande. Il est maintenant logarithmique, donc le spectre et les barres remplissent le cadre. Dans l'aperçu, le spectre est aussi dessiné en direct à partir du son du moniteur.",
      },
      {
        q: 'Comment garder un compte à rebours qui continue même hors antenne ?',
        a: "Sur le calque Compte à rebours, cochez « Continuer en arrière-plan » (ou cliquez sur « ⟳ Fond » sous le moniteur). Le décompte suit alors l'horloge réelle : il continue même quand la scène n'est ni en programme ni dans l'aperçu. Désactivé, il repart du début à chaque passage à l'antenne.",
      },
      {
        q: 'Pourquoi mes visuels réactifs ne bougeaient-ils pas ?',
        a: "Ils étaient alimentés par du silence. Désormais un calque réactif réagit à la musique de fond de l'élément (ou au son de la vidéo s'il n'y a pas de musique).",
      },
      {
        q: 'Comment changer la police d’un compte à rebours ?',
        a: "Sur le calque Compte à rebours (comme Horloge ou Bandeau), un sélecteur « Police » et une taille sont disponibles en plus de la couleur.",
      },
    ],
  },
  {
    title: 'Démarrage, mise à jour, dépannage',
    items: [
      {
        q: 'Comment démarrer la diffusion ?',
        a: "Onglet Aperçu / Programme, bouton « Démarrer le direct ». Choisissez la playlist et la sortie (sortie principale, un flux précis, ou tous les flux).",
      },
      {
        q: 'Comment mettre à jour LocalLive ?',
        a: "Onglet Paramètres → « Mettre à jour » : l'application applique la dernière version et redémarre. Un message s'affiche une seule fois à la réouverture.",
      },
      {
        q: 'Le bouton « Mettre à jour » demande une configuration manuelle, pourquoi ?',
        a: "Cela arrivait quand le service ne pouvait pas exécuter l'outil de mise à jour (droits sudo bloqués, outil obsolète, ou paquet sudo absent). Les versions 2.15.1+ corrigent ces points : relancez install.sh sur le serveur (ou une mise à jour manuelle) pour les appliquer une dernière fois.",
      },
      {
        q: 'Comment sauvegarder ma configuration ?',
        a: "Onglet Paramètres → export de la configuration (scènes, playlists, flux, programmes, dossiers, réglages). L'import est additif par défaut, ou remplace tout si demandé.",
      },
      {
        q: 'Où sont stockés mes médias et ma base ?',
        a: "Tout vit sous le dossier de données (par défaut /var/lib/locallive en production) : media/, thumbs/, previews/ et locallive.db. Le script backup.sh sauvegarde tout.",
      },
      {
        q: 'Un compte à rebours ne démarre pas, que faire ?',
        a: "Sous le moniteur, le bouton « ▶ Démarrer » lance le décompte dans l'aperçu et relance l'élément à l'antenne. Les boutons +10/+30/+60 s ajoutent du temps.",
      },
      {
        q: 'Pourquoi la page d’aperçu affiche-t-elle un écran noir ?',
        a: "Un indicateur de chargement s'affiche pendant le chargement. Si la scène est indisponible, un message le signale : vérifiez la connexion au serveur.",
      },
    ],
  },
]

export default function Faq() {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SECTIONS
    return SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter((it) => it.q.toLowerCase().includes(q) || it.a.toLowerCase().includes(q)),
    })).filter((s) => s.items.length > 0)
  }, [query])

  const total = SECTIONS.reduce((n, s) => n + s.items.length, 0)

  return (
    <>
      <div className="page-head">
        <span className="muted">{total} questions fréquentes</span>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-3)' }}>
            <IconSearch size={16} />
          </span>
          <input
            className="input"
            style={{ paddingLeft: 36, width: 300 }}
            placeholder="Rechercher dans la FAQ…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <span>Aucune question ne correspond à cette recherche.</span>
        </div>
      )}

      {filtered.map((section) => (
        <div className="card mb-16" key={section.title}>
          <div className="card-head">
            <span className="card-title">{section.title}</span>
          </div>
          {section.items.map((item, i) => (
            <details className="faq-item" key={i} open={Boolean(query)}>
              <summary>{item.q}</summary>
              <p className="faq-answer">{item.a}</p>
            </details>
          ))}
        </div>
      ))}
    </>
  )
}
