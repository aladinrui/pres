import { useAppSelector } from '../store/hooks'

export type Lang = 'fr' | 'en'

/** Returns 'en' when the logged-in user belongs to the 'tod' tenant, 'fr' otherwise. */
export function useLang(): Lang {
  const tenant = useAppSelector((s) => s.user.userDetail?.tenant)
  return tenant === 'tod' ? 'en' : 'fr'
}

export const JOURS_FR  = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi']
export const JOURS_COURT_FR = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
export const MOIS_FR   = [
  'janvier','février','mars','avril','mai','juin',
  'juillet','août','septembre','octobre','novembre','décembre',
]

export const JOURS_EN  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
export const JOURS_COURT_EN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
export const MOIS_EN   = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

export function getJours(lang: Lang): string[]      { return lang === 'en' ? JOURS_EN : JOURS_FR }
export function getJoursCourt(lang: Lang): string[] { return lang === 'en' ? JOURS_COURT_EN : JOURS_COURT_FR }
export function getMois(lang: Lang): string[]       { return lang === 'en' ? MOIS_EN : MOIS_FR }
export function getLocale(lang: Lang): string       { return lang === 'en' ? 'en-US' : 'fr-FR' }
