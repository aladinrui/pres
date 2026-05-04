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
  return parseBackendDate(iso).toLocaleTimeString('fr-FR', {
    timeZone: BUSINESS_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  })
}

export function convertUtcHHMMToBusinessHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date(Date.UTC(1970, 0, 1, h, m, 0))
  const p = getZonedParts(d)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
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