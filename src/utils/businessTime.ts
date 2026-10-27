export const BUSINESS_TIME_ZONE = 'Africa/Cairo'

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function getZonedParts(date: Date = new Date()): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value
    return Number(value ?? 0)
  }

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

export function getBusinessNowDate(): Date {
  const p = getZonedParts(new Date())
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

export function toBusinessISODate(date: Date = new Date()): string {
  const p = getZonedParts(date)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function toBusinessYearMonth(date: Date = new Date()): string {
  const p = getZonedParts(date)
  return `${p.year}-${String(p.month).padStart(2, '0')}`
}

function parseBackendDate(value: string): Date {
  const trimmed = value.trim()
  const normalized = trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
  const iso = hasTimezone ? normalized : `${normalized}Z`
  return new Date(iso)
}

export function formatIsoTimeInBusinessTZ(iso: string, withSeconds = false): string {
  const d = parseBackendDate(iso)
  const p = getZonedParts(d)
  const hhmm = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  if (withSeconds) return `${hhmm}:${String(p.second).padStart(2, '0')}`
  return hhmm
}

export function convertUtcHHMMToBusinessHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(Date.UTC(1970, 0, 1, h, m, 0))
  const p = getZonedParts(d)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/**
 * Heure locale du bureau telle que renvoyée par l'API /presence
 * ("2026-10-26T11:48:01.840" ou "HH:MM:SS") → "HH:MM" (ou "HH:MM:SS").
 * Aucune conversion de fuseau : la chaîne est déjà à l'heure du bureau.
 */
export function formatLocalTime(value: string, withSeconds = false): string {
  const trimmed = value.trim()
  const isFull = /^\d{4}-\d{2}-\d{2}[T ]/.test(trimmed)
  const time = isFull ? trimmed.slice(11) : trimmed
  const [h = '0', m = '0', s = '0'] = time.split(':')
  const hhmm = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
  const out = withSeconds ? `${hhmm}:${s.slice(0, 2).padStart(2, '0')}` : hhmm
  // "HH:MM:SS" seul (checkin_time des alertes) = pointage du jour
  const date = isFull ? trimmed.slice(0, 10) : todayLocalISO()
  return isDstPatchDate(date) ? shiftHHMM(out, -DST_PATCH_HOURS) : out
}

// ── PATCH TEMPORAIRE heure d'été Égypte ────────────────────────────────────
// Le back calcule l'heure locale du bureau avec +1h de trop pendant l'heure
// d'été du Caire (24/04 → 29/10/2026). On retire 1h à l'affichage et on la
// rajoute avant d'envoyer NewHours à update_hours.
// À supprimer une fois le back corrigé.
const DST_PATCH_FROM = '2026-04-24'
const DST_PATCH_TO = '2026-10-29'
const DST_PATCH_HOURS = 1

function todayLocalISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isDstPatchDate(isoDate: string): boolean {
  return isoDate >= DST_PATCH_FROM && isoDate <= DST_PATCH_TO
}

/** "HH:MM" saisi par l'utilisateur → valeur attendue par update_hours */
export function toApiLocalHHMM(isoDate: string, hhmm: string): string {
  return isDstPatchDate(isoDate) ? shiftHHMM(hhmm, DST_PATCH_HOURS) : hhmm
}

/** Returns Cairo time in total minutes for a full backend timestamp */
export function parseBackendTimestampToCairoMinutes(value: string): number | null {
  const trimmed = value.trim()
  const normalized = trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
  const iso = hasTimezone ? normalized : `${normalized}Z`
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const p = getZonedParts(d)
  return p.hour * 60 + p.minute
}

/** Bureau-specific hour offsets relative to Cairo (UTC+2). Negative = behind Cairo. */
export const BUREAU_HOUR_OFFSET: Record<number, number> = {
  5: -2,  // MRO  : UTC+0, Cairo UTC+2
  12: -2, // MRO2 : même fuseau que MRO
}

function shiftHHMM(hhmm: string, offsetHours: number): string {
  const parts = hhmm.split(':')
  const h = Number(parts[0])
  const m = Number(parts[1])
  const s = parts[2] !== undefined ? Number(parts[2]) : undefined
  const totalMin = ((h * 60 + m + offsetHours * 60) % 1440 + 1440) % 1440
  const nh = Math.floor(totalMin / 60)
  const nm = totalMin % 60
  const base = `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`
  return s !== undefined ? `${base}:${String(s).padStart(2, '0')}` : base
}

/** Comme formatIsoTimeInBusinessTZ mais applique le décalage du bureau */
export function formatTimeForBureau(iso: string, bureauId: number, withSeconds = false): string {
  const base = formatIsoTimeInBusinessTZ(iso, withSeconds)
  const offset = BUREAU_HOUR_OFFSET[bureauId] ?? 0
  if (offset === 0) return base
  return shiftHHMM(base, offset)
}

/** Comme parseToCairoHHMM mais applique le décalage du bureau */
export function parseToBureauHHMM(value: string, bureauId: number): string {
  const base = parseToCairoHHMM(value)
  const offset = BUREAU_HOUR_OFFSET[bureauId] ?? 0
  if (offset === 0) return base
  return shiftHHMM(base, offset)
}

/**
 * Universal converter: accepts ANY backend value — full timestamp ("2026-05-04 08:16:10")
 * OR plain time ("08:16" / "08:16:10") — always returns Cairo "HH:MM".
 */
export function parseToCairoHHMM(value: string): string {
  const trimmed = value.trim()
  if (/^\d{4}-/.test(trimmed) || trimmed.includes('T')) {
    // Full timestamp
    const p = getZonedParts(parseBackendDate(trimmed))
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  }
  // Plain HH:MM or HH:MM:SS — treat as UTC
  const [h = '0', m = '0'] = trimmed.split(':')
  const d = new Date(Date.UTC(1970, 0, 1, Number(h), Number(m), 0))
  const p = getZonedParts(d)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}