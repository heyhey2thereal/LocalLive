// Minimal i18n layer. French ships first; the dictionary shape is ready for
// additional locales (add a `en` entry and switch via setLocale).

type Dict = Record<string, string>

const fr: Dict = {
  'app.name': 'LocalLive',
  'app.tagline': 'Régie de diffusion 24/7',
  'nav.dashboard': 'Tableau de bord',
  'nav.preview': 'Aperçu / Programme',
  'nav.streams': 'Flux de sortie',
  'nav.media': 'Médiathèque',
  'nav.playlists': 'Playlists',
  'nav.scenes': 'Scènes',
  'nav.schedule': 'Programmation',
  'nav.users': 'Utilisateurs',
  'nav.settings': 'Paramètres',
  'nav.logout': 'Déconnexion',
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.delete': 'Supprimer',
  'common.edit': 'Modifier',
  'common.rename': 'Renommer',
  'common.close': 'Fermer',
  'common.create': 'Créer',
  'common.add': 'Ajouter',
  'common.loading': 'Chargement…',
  'common.empty': 'Aucun élément',
  'common.search': 'Rechercher',
  'common.confirm': 'Confirmer',
  'common.back': 'Retour',
  'common.next': 'Suivant',
  'common.finish': 'Terminer',
  'common.yes': 'Oui',
  'common.no': 'Non',
  'login.title': 'Connexion',
  'login.subtitle': 'Accédez à votre régie',
  'login.username': "Nom d'utilisateur",
  'login.password': 'Mot de passe',
  'login.submit': 'Se connecter',
  'setup.title': 'Assistant d’installation',
  'dashboard.title': 'Tableau de bord',
  'preview.title': 'Aperçu / Programme',
  'streams.title': 'Flux de sortie',
  'media.title': 'Médiathèque',
  'playlists.title': 'Playlists',
  'scenes.title': 'Scènes',
  'schedule.title': 'Programmation',
  'users.title': 'Utilisateurs',
  'settings.title': 'Paramètres',
}

const en: Dict = {
  'app.name': 'LocalLive',
  'app.tagline': '24/7 broadcasting control room',
  'nav.dashboard': 'Dashboard',
  'nav.preview': 'Preview / Program',
  'nav.streams': 'Output streams',
  'nav.media': 'Media library',
  'nav.playlists': 'Playlists',
  'nav.scenes': 'Scenes',
  'nav.schedule': 'Scheduling',
  'nav.users': 'Users',
  'nav.settings': 'Settings',
  'nav.logout': 'Log out',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.rename': 'Rename',
  'common.close': 'Close',
  'common.create': 'Create',
  'common.add': 'Add',
  'common.loading': 'Loading…',
  'common.empty': 'Nothing here',
  'common.search': 'Search',
  'common.confirm': 'Confirm',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.finish': 'Finish',
  'common.yes': 'Yes',
  'common.no': 'No',
  'login.title': 'Sign in',
  'login.subtitle': 'Access your control room',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'setup.title': 'Setup wizard',
  'dashboard.title': 'Dashboard',
  'preview.title': 'Preview / Program',
  'streams.title': 'Output streams',
  'media.title': 'Media library',
  'playlists.title': 'Playlists',
  'scenes.title': 'Scenes',
  'schedule.title': 'Scheduling',
  'users.title': 'Users',
  'settings.title': 'Settings',
}

const dictionaries: Record<string, Dict> = { fr, en }
let current = 'fr'

export function setLocale(locale: string) {
  if (dictionaries[locale]) current = locale
}

export function t(key: string): string {
  return dictionaries[current]?.[key] ?? dictionaries.fr[key] ?? key
}
