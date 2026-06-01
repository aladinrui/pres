import React, { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { logout } from '../features/auth/authSlice'
import { buildBureauNameMap } from '../utils/bureaux'
import { toBusinessISODate, formatIsoTimeInBusinessTZ, convertUtcHHMMToBusinessHHMM, parseToCairoHHMM } from '../utils/businessTime'
import { useLang, getLocale } from '../utils/i18n'

const API = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000') + '/api'

type AgentRecap = {
  user_id: number
  username: string
  month: string
  absences_count: number
  retards_count: number
  conges_count: number
  non_pointe_count?: number
}

type DateRange = {
  from: string
  to: string
}

type BureauRecapApiResponse = {
  bureau_id: number
  daterange: DateRange
  schedule_start: string
  total_records: number
  data: AgentRecap[]
}

type AgentDetailDay = {
  date: string
  status: string
  checkin_time: string | null
  is_retard: boolean
  note: string | null
}

type AgentDetailResponse = {
  user_id: number
  username: string
  daterange: DateRange
  schedule_start: string
  total_days: number
  days: AgentDetailDay[]
}

type BureauRecapView = {
  bureau_id: number
  bureau_name?: string
  daterange: DateRange
  schedule_start: string
  total_records: number
  rows: AgentRecap[]
}

const MOCK_BUREAU_RECAP: BureauRecapApiResponse = {
  bureau_id: 3,
  daterange: {
    from: '2026-05-01',
    to: '2026-05-31',
  },
  schedule_start: '10:30:00',
  total_records: 2,
  data: [
    {
      user_id: 12,
      username: 'john',
      month: '2026-05',
      absences_count: 2,
      retards_count: 3,
      conges_count: 1,
    },
    {
      user_id: 45,
      username: 'marie',
      month: '2026-04',
      absences_count: 1,
      retards_count: 5,
      conges_count: 2,
    },
  ],
}

const MOCK_AGENT_DETAIL: AgentDetailResponse = {
  user_id: 12,
  username: 'john',
  daterange: { from: '2026-04-01', to: '2026-05-31' },
  schedule_start: '10:30:00',
  total_days: 3,
  days: [
    { date: '2026-04-01', status: 'absent', checkin_time: null, is_retard: false, note: 'malade' },
    { date: '2026-04-02', status: 'present', checkin_time: '10:45:30', is_retard: true, note: null },
    { date: '2026-04-03', status: 'conge', checkin_time: null, is_retard: false, note: 'conge paye' },
  ],
}

function addDaysToIsoDate(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function normalizeStatus(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function statusLabel(status: string): string {
  const key = normalizeStatus(status)
  if (key === 'present') return 'Present'
  if (key === 'absent') return 'Absent'
  if (key === 'conge') return 'Conge'
  if (key === 'retard') return 'Present'
  if (key === 'non_pointe') return 'Non pointé'
  return status
}

function statusClass(status: string): string {
  const key = normalizeStatus(status)
  if (key === 'present') return 'status-present'
  if (key === 'absent') return 'status-absent'
  if (key === 'conge') return 'status-conge'
  if (key === 'retard') return 'status-present'
  if (key === 'non_pointe') return 'status-non-pointe'
  return ''
}

function resolveCheckinTime(day: AgentDetailDay): string | null {
  const direct = typeof day.checkin_time === 'string' ? day.checkin_time.trim() : ''
  if (direct) return direct

  const record = day as unknown as Record<string, unknown>
  const fallbackKeys = ['checkin', 'first_checkin', 'first_checkin_time']
  for (const key of fallbackKeys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  return null
}

function formatCheckinHHMM(day: AgentDetailDay): string | null {
  const raw = resolveCheckinTime(day)
  if (!raw) return null
  const trimmed = raw.trim()
  // Full timestamp (e.g. "2026-05-04 08:16:10" or ISO with T) → convert UTC → Cairo
  if (/^\d{4}-/.test(trimmed) || trimmed.includes('T')) {
    return parseToCairoHHMM(trimmed)
  }
  // Plain "HH:MM" or "HH:MM:SS" — already in local (Cairo) time, just extract HH:MM
  const parts = trimmed.split(':')
  return `${(parts[0] ?? '00').padStart(2, '0')}:${(parts[1] ?? '00').padStart(2, '0')}`
}

function formatDayLabel(iso: string, locale: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d
    .toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: 'short' })
    .replace('.', '')
}

function formatMonthLabel(ym: string, locale: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return ym
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

function timeToSeconds(value: string | null): number | null {
  if (!value) return null
  const time = value.trim().split('T').pop() ?? value.trim()
  const [hh = '0', mm = '0', ss = '0'] = time.split(':')
  const h = Number(hh)
  const m = Number(mm)
  const s = Number(ss)
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(s)) return null
  return h * 3600 + m * 60 + s
}

function isRetardDay(day: AgentDetailDay, scheduleStart: string): boolean {
  if (day.is_retard) return true
  // Use the Cairo-converted time so the comparison is consistent with schedule_start
  const checkin = formatCheckinHHMM(day)
  const checkinSec = timeToSeconds(checkin)
  const startSec = timeToSeconds(scheduleStart)
  if (checkinSec === null || startSec === null) return false
  return checkinSec > startSec
}

/** Insère les jours ouvrables (lun-ven) manquants dans la plage comme lignes 'non_pointe' */
function fillWeekdays(days: AgentDetailDay[], from: string, to: string): AgentDetailDay[] {
  const existing = new Set(days.map((d) => d.date))
  const result: AgentDetailDay[] = [...days]
  const end = new Date(to + 'T00:00:00')
  const cur = new Date(from + 'T00:00:00')
  while (cur <= end) {
    const dow = cur.getDay() // 0=dim, 6=sam
    if (dow !== 0 && dow !== 6) {
      const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
      if (!existing.has(iso)) {
        result.push({ date: iso, status: 'non_pointe', checkin_time: null, is_retard: false, note: null })
      }
    }
    cur.setDate(cur.getDate() + 1)
  }
  result.sort((a, b) => a.date.localeCompare(b.date))
  return result
}

const CrmRecap: React.FC = () => {
  const dispatch = useAppDispatch()
  const userDetail = useAppSelector((s) => s.user.userDetail)
  const lang = useLang()
  const locale = getLocale(lang)

  const username = userDetail?.username ?? ''
  const profil = String(userDetail?.profil ?? '')
  const profileLower = profil.toLowerCase()
  const isAdmin = ['admin', 'superadmin'].includes(profileLower)

  // Bureaux et noms viennent du token login (pres → CRN/STV/etc, tod → 2.1/etc)
  const myBureauId: number = userDetail?.bureau_id ?? (userDetail?.bureaux?.[0] as any)?.id ?? 0
  const managedBureauIds: number[] = useMemo(() => {
    return Array.from(new Set(
      (userDetail?.bureaux ?? [])
        .map((b: any) => Number(b?.id))
        .filter((id: number) => Number.isFinite(id) && id > 0)
    ))
  }, [userDetail?.bureaux])
  // Noms : JWT en priorité, fallback sur noms connus (pres : CRN/STV/etc, tod : du JWT)
  const bureauNameMap = useMemo(
    () => buildBureauNameMap(userDetail?.bureaux),
    [userDetail?.bureaux]
  )

  // Tous les rôles utilisent leurs bureaux du token
  const bureauIdsForApi: number[] = useMemo(() => {
    return managedBureauIds.length > 0
      ? managedBureauIds
      : (myBureauId ? [myBureauId] : [])
  }, [managedBureauIds, myBureauId])

  const today = toBusinessISODate()
  const [dateTo, setDateTo] = useState<string>(today)
  const [dateFrom, setDateFrom] = useState<string>('2026-06-01')

  const [bureauxData, setBureauxData] = useState<BureauRecapView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Admin voit tout ('all'), manager voit son bureau par défaut
  const defaultBureau: number | 'all' = isAdmin ? 'all' : (bureauIdsForApi[0] ?? 'all')
  const [selectedBureau, setSelectedBureau] = useState<number | 'all'>(defaultBureau)
  const [search, setSearch] = useState('')

  const [openedRowKey, setOpenedRowKey] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [agentDetail, setAgentDetail] = useState<AgentDetailResponse | null>(null)
  // Cache non_pointe_count calculé depuis le détail : clé = "bureauId-userId-month"
  const [nonPointeCache, setNonPointeCache] = useState<Record<string, number>>({})
  // Seuils personnalisés par bureau (override du schedule_start de l'API)
  const [bureauThresholds, setBureauThresholds] = useState<Record<number, string>>({})

  const availableBureaux = useMemo(() => {
    const fromApi = bureauxData.map((b) => b.bureau_id)
    const merged = Array.from(new Set([...bureauIdsForApi, ...fromApi]))
    return merged.sort((a, b) => a - b)
  }, [bureauIdsForApi, bureauxData])

  const fetchRecap = useCallback(async () => {
    if (dateFrom > dateTo) {
      setError('Periode invalide: "from" doit etre inferieure ou egale a "to".')
      setLoading(false)
      return
    }

    const bureauxToFetch = selectedBureau === 'all' ? bureauIdsForApi : [selectedBureau]
    if (bureauxToFetch.length === 0) {
      setBureauxData([])
      setLoading(false)
      setError('Aucun bureau disponible pour ce profil.')
      return
    }

    try {
      setLoading(true)
      setError(null)

      const results = await Promise.allSettled(
        bureauxToFetch.map(async (bureauId) => {
          const payload = {
            bureau_id: bureauId,
            daterange: { from: dateFrom, to: dateTo },
          }
          const res = await axios.post<BureauRecapApiResponse>(`${API}/presence/absences-retards-conges`, payload)
          return res.data
        })
      )

      const okResponses = results
        .filter((r): r is PromiseFulfilledResult<BureauRecapApiResponse> => r.status === 'fulfilled')
        .map((r) => r.value)

      if (okResponses.length === 0) {
        throw new Error('Aucune reponse exploitable.')
      }

      const mapped = okResponses.map((r) => ({
        bureau_id: r.bureau_id,
        bureau_name: bureauNameMap[r.bureau_id],
        daterange: r.daterange,
        schedule_start: r.schedule_start,
        total_records: r.total_records,
        rows: r.data ?? [],
      }))

      setBureauxData(mapped)
    } catch (err: any) {
      const fallbackBureaux = bureauxToFetch.map((id) => ({
        bureau_id: id,
        bureau_name: bureauNameMap[id],
        daterange: { from: dateFrom, to: dateTo },
        schedule_start: MOCK_BUREAU_RECAP.schedule_start,
        total_records: id === MOCK_BUREAU_RECAP.bureau_id ? MOCK_BUREAU_RECAP.total_records : 0,
        rows: id === MOCK_BUREAU_RECAP.bureau_id ? MOCK_BUREAU_RECAP.data : [],
      }))
      setBureauxData(fallbackBureaux)
      setError(err?.response?.data?.message || 'API indisponible, affichage mock temporaire.')
    } finally {
      setOpenedRowKey(null)
      setAgentDetail(null)
      setDetailError(null)
      setNonPointeCache({})
      setLoading(false)
    }
  }, [API, bureauIdsForApi, dateFrom, dateTo, selectedBureau])

  useEffect(() => {
    fetchRecap()
  }, [fetchRecap])

  // Calcul en arrière-plan du non_pointe pour tous les agents dès que le récap est chargé
  useEffect(() => {
    if (bureauxData.length === 0) return
    const tasks: Array<{ bureauId: number; userId: number; month: string; rowKey: string }> = []
    bureauxData.forEach((b) => {
      b.rows.forEach((row) => {
        const rowKey = `${b.bureau_id}-${row.user_id}-${row.month}`
        tasks.push({ bureauId: b.bureau_id, userId: row.user_id, month: row.month, rowKey })
      })
    })
    if (tasks.length === 0) return
    let cancelled = false
    ;(async () => {
      for (const t of tasks) {
        if (cancelled) break
        try {
          const payload = { user_id: t.userId, daterange: { from: dateFrom, to: dateTo } }
          const res = await axios.post<AgentDetailResponse>(`${API}/presence/agent-detail`, payload)
          const enrichedDays = fillWeekdays(res.data.days, res.data.daterange.from, res.data.daterange.to)
          const np = enrichedDays.filter((d) => {
            const key = normalizeStatus(d.status)
            return !resolveCheckinTime(d) && key !== 'absent' && key !== 'conge'
          }).length
          if (!cancelled) setNonPointeCache((prev) => ({ ...prev, [t.rowKey]: np }))
        } catch {
          // silencieux
        }
      }
    })()
    return () => { cancelled = true }
  }, [bureauxData, API, dateFrom, dateTo])

  useEffect(() => {
    if (selectedBureau === 'all') return
    if (!availableBureaux.includes(selectedBureau)) {
      setSelectedBureau(availableBureaux[0] ?? 'all')
    }
  }, [availableBureaux, selectedBureau])

  const openAgentDetail = useCallback(async (userId: number, rowKey: string) => {
    if (openedRowKey === rowKey) {
      setOpenedRowKey(null)
      setAgentDetail(null)
      setDetailError(null)
      return
    }

    setOpenedRowKey(rowKey)
    setDetailLoading(true)
    setDetailError(null)
    try {
      const payload = {
        user_id: userId,
        daterange: { from: dateFrom, to: dateTo },
      }
      const res = await axios.post<AgentDetailResponse>(`${API}/presence/agent-detail`, payload)
      const enrichedDays = fillWeekdays(res.data.days, res.data.daterange.from, res.data.daterange.to)
      const enriched = { ...res.data, days: enrichedDays }
      setAgentDetail(enriched)
      // Calcul du non_pointe depuis le détail et mise en cache
      const np = enrichedDays.filter((d) => {
        const key = normalizeStatus(d.status)
        return !resolveCheckinTime(d) && key !== 'absent' && key !== 'conge'
      }).length
      setNonPointeCache((prev) => ({ ...prev, [rowKey]: np }))
    } catch (err: any) {
      const mockDetail = { ...MOCK_AGENT_DETAIL, user_id: userId }
      const enrichedMockDays = fillWeekdays(mockDetail.days, mockDetail.daterange.from, mockDetail.daterange.to)
      const enrichedMock = { ...mockDetail, days: enrichedMockDays }
      setAgentDetail(enrichedMock)
      const np = enrichedMockDays.filter((d) => {
        const key = normalizeStatus(d.status)
        return !resolveCheckinTime(d) && key !== 'absent' && key !== 'conge'
      }).length
      setNonPointeCache((prev) => ({ ...prev, [rowKey]: np }))
      setDetailError(err?.response?.data?.message || 'Detail indisponible, affichage mock temporaire.')
    } finally {
      setDetailLoading(false)
    }
  }, [API, dateFrom, dateTo, openedRowKey])

  const visibleBureaux = useMemo(() => {
    if (bureauxData.length === 0) return []

    const q = search.trim().toLowerCase()

    return bureauxData
      .filter((b) => selectedBureau === 'all' || b.bureau_id === selectedBureau)
      .map((b) => {
        const filteredRows = b.rows
          .filter((a) => {
            if (!q) return true
            return (
              a.username.toLowerCase().includes(q) ||
              a.month.toLowerCase().includes(q)
            )
          })
          .sort((a, b2) => {
            const totalA = a.absences_count + a.retards_count + a.conges_count + (a.non_pointe_count ?? 0)
            const totalB = b2.absences_count + b2.retards_count + b2.conges_count + (b2.non_pointe_count ?? 0)
            return totalB - totalA
          })

        return {
          ...b,
          rows: filteredRows,
        }
      })
      .filter((b) => b.rows.length > 0)
  }, [bureauxData, selectedBureau, search])

  const detailCounters = useMemo(() => {
    const base = { present: 0, absent: 0, conge: 0, retard: 0, non_pointe: 0 }
    if (!agentDetail?.days) return base
    return agentDetail.days.reduce((acc, day) => {
      const key = normalizeStatus(day.status)
      if (key === 'present') acc.present += 1
      if (key === 'absent') acc.absent += 1
      if (key === 'conge') acc.conge += 1
      if (day.is_retard) acc.retard += 1
      if (!day.checkin_time && key !== 'absent' && key !== 'conge') acc.non_pointe += 1
      return acc
    }, base)
  }, [agentDetail])

  return (
    <div className="presence-page">
      <header className="presence-header">
        <div className="header-left">
          <span className="header-logo">📈</span>
          <span className="header-title">{lang === 'en' ? 'CRM Recap — Leave / Absences / Lates' : 'Récap CRM — Congés / Absences / Retards'}</span>
        </div>
        <div className="header-right">
          <span className="header-user">
            <span className="header-username">{username}</span>
            {profil && <span className="header-badge">{profil}</span>}
          </span>

          {isAdmin ? (
            <>
              <Link to="/manager" className="btn-manager-link">{lang === 'en' ? '📊 Overview' : '📊 Général'}</Link>
              <Link to="/manager/day" className="btn-manager-link">{lang === 'en' ? '📅 Day View' : '📅 Journée'}</Link>
              <Link to="/manager/agents" className="btn-manager-link">{lang === 'en' ? '👥 Agents' : '👥 Agents'}</Link>
              <span className="btn-manager-link btn-manager-link--active">{lang === 'en' ? '📈 CRM Recap' : '📈 CRM Récap'}</span>
            </>
          ) : (
            <>
              <Link to="/pointer" className="btn-manager-link">{lang === 'en' ? '⏱ Clock' : '⏱ Pointer'}</Link>
              <Link to="/manager/day" className="btn-manager-link">{lang === 'en' ? '📅 Day View' : '📅 Journée'}</Link>
              <Link to="/manager/agents" className="btn-manager-link">{lang === 'en' ? '👥 Agents' : '👥 Agents'}</Link>
              <span className="btn-manager-link btn-manager-link--active">{lang === 'en' ? '📈 CRM Recap' : '📈 CRM Récap'}</span>
            </>
          )}

          <button className="btn-logout" onClick={() => dispatch(logout())}>{lang === 'en' ? 'Logout' : 'Déconnexion'}</button>
        </div>
      </header>

      <div className="manager-layout">
        <section className="crm-recap-top">
          <div>
            <h1 className="crm-recap-title">{lang === 'en' ? 'Summary by office and by agent' : 'Synthèse par bureau et par agent'}</h1>
            <p className="crm-recap-subtitle">
              {dateFrom} → {dateTo}
            </p>
          </div>
        </section>

        {error && <div className="alert-error">{error}</div>}

        {loading ? (
          <div className="loading-state">{lang === 'en' ? 'Loading recap...' : 'Chargement du récap...'}</div>
        ) : (
          <>
            <section className="crm-toolbar">
              <div className="crm-toolbar-field">
                <label htmlFor="crm-bureau">{lang === 'en' ? 'Office' : 'Bureau'}</label>
                <select
                  id="crm-bureau"
                  className="bureau-select"
                  value={selectedBureau === 'all' ? 'all' : String(selectedBureau)}
                  onChange={(e) => {
                    setSelectedBureau(e.target.value === 'all' ? 'all' : Number(e.target.value))
                  }}
                >
                  {/* Admin voit "Tous" + chaque bureau. CRM manager voit uniquement ses bureaux */}
                  {isAdmin && <option value="all">{lang === 'en' ? 'All offices' : 'Tous les bureaux'}</option>}
                  {availableBureaux.map((id) => (
                    <option key={id} value={id}>
                      {bureauNameMap[id] ? `${bureauNameMap[id]} (${id})` : `Bureau ${id}`}
                    </option>
                  ))}
                  {/* Si plusieurs bureaux assignés au manager, "Tous ses bureaux" apparaît aussi */}
                  {!isAdmin && bureauIdsForApi.length > 1 && (
                    <option value="all">{lang === 'en' ? 'All my offices' : 'Tous mes bureaux'}</option>
                  )}
                </select>
              </div>

              <div className="crm-toolbar-field">
                <label htmlFor="crm-from">{lang === 'en' ? 'From' : 'Du'}</label>
                <input
                  id="crm-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>

              <div className="crm-toolbar-field">
                <label htmlFor="crm-to">{lang === 'en' ? 'To' : 'Au'}</label>
                <input
                  id="crm-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>

              <div className="crm-toolbar-field crm-toolbar-field-search">
                <label htmlFor="crm-search">{lang === 'en' ? 'Agent / Profile' : 'Agent / Profil'}</label>
                <input
                  id="crm-search"
                  type="text"
                  placeholder="Ex: agent, manager..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <button className="btn-refresh" onClick={fetchRecap}>{lang === 'en' ? 'Refresh' : 'Rafraîchir'}</button>
            </section>

            <section className="crm-bureaux-list">
              {visibleBureaux.length === 0 ? (
                <div className="week-loading">{lang === 'en' ? 'No data for this filter.' : 'Aucune donnée pour ce filtre.'}</div>
              ) : (
                visibleBureaux.map((bureau) => {
                  const bAbs = bureau.rows.reduce((acc, a) => acc + a.absences_count, 0)
                  const bRet = bureau.rows.reduce((acc, a) => acc + a.retards_count, 0)
                  const bCon = bureau.rows.reduce((acc, a) => acc + a.conges_count, 0)
                  // Seuil effectif : override local ou valeur API (on normalise en HH:MM pour l'input)
                  const apiThreshold = bureau.schedule_start.substring(0, 5)
                  const effectiveThreshold = bureauThresholds[bureau.bureau_id] ?? apiThreshold

                  return (
                    <article key={bureau.bureau_id} className="crm-bureau-card">
                      <div className="crm-bureau-head">
                        <h2>{bureau.bureau_name ? `${bureau.bureau_name} (${bureau.bureau_id})` : `Bureau ${bureau.bureau_id}`}</h2>
                        <div className="crm-bureau-stats">
                          <span>{bureau.total_records} {lang === 'en' ? 'rows' : 'lignes'}</span>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                            {lang === 'en' ? '⏰ Threshold:' : '⏰ Seuil:'}
                            <input
                              type="time"
                              className="threshold-input"
                              value={effectiveThreshold}
                              onChange={(e) => setBureauThresholds((prev) => ({ ...prev, [bureau.bureau_id]: e.target.value }))}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </label>
                          <span className="crm-pill crm-pill-abs">{lang === 'en' ? 'Abs' : 'Abs'}: {bAbs}</span>
                          <span className="crm-pill crm-pill-ret">{lang === 'en' ? 'Late' : 'Ret'}: {bRet}</span>
                          <span className="crm-pill crm-pill-con">{lang === 'en' ? 'Leave' : 'Congé'}: {bCon}</span>
                        </div>
                      </div>

                      <div className="crm-table-wrap">
                        <table className="crm-table">
                          <thead>
                            <tr>
                              <th>Agent</th>
                              <th>{lang === 'en' ? 'Month' : 'Mois'}</th>
                              <th>{lang === 'en' ? 'Absences' : 'Absences'}</th>
                              <th>{lang === 'en' ? 'Lates' : 'Retards'}</th>
                              <th>{lang === 'en' ? 'Leave' : 'Congés'}</th>
                              <th>{lang === 'en' ? 'Not clocked' : 'Non pointé'}</th>
                              <th>{lang === 'en' ? 'Total alerts' : 'Total alertes'}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bureau.rows.map((row) => {
                              const total = row.absences_count + row.retards_count + row.conges_count
                              const rowKey = `${bureau.bureau_id}-${row.user_id}-${row.month}`
                              const isOpen = openedRowKey === rowKey
                              return (
                                <React.Fragment key={rowKey}>
                                <tr>
                                  <td>
                                    <button
                                      type="button"
                                      className="crm-row-trigger"
                                      onClick={() => openAgentDetail(row.user_id, rowKey)}
                                    >
                                      {row.username}
                                    </button>
                                  </td>
                                  <td>{formatMonthLabel(row.month, locale)}</td>
                                  <td>{row.absences_count}</td>
                                  <td>{row.retards_count}</td>
                                  <td>{row.conges_count}</td>
                                  <td>{row.non_pointe_count ?? nonPointeCache[rowKey] ?? '—'}</td>
                                  <td><strong>{total}</strong></td>
                                </tr>
                                {isOpen && (
                                  <tr className="crm-detail-row">
                                    <td colSpan={7}>
                                      <div className="crm-detail-panel">
                                        {detailLoading && <div className="week-loading">{lang === 'en' ? 'Loading agent detail...' : 'Chargement du détail agent...'}</div>}
                                        {detailError && <div className="alert-error">{detailError}</div>}

                                        {!detailLoading && agentDetail && (
                                          <>
                                            <div className="crm-detail-head">
                                              <div>
                                                <h3>{agentDetail.username}</h3>
                                              </div>
                                              <div className="crm-detail-meta">
                                                <span>Seuil: {effectiveThreshold}</span>
                                                <span>{lang === 'en' ? 'Total days' : 'Total jours'}: {agentDetail.total_days}</span>
                                              </div>
                                            </div>

                                            <div className="crm-detail-counters">
                                              <span className="crm-pill">Present: {detailCounters.present}</span>
                                              <span className="crm-pill crm-pill-abs">Absent: {detailCounters.absent}</span>
                                              <span className="crm-pill crm-pill-ret">Retard: {detailCounters.retard}</span>
                                              <span className="crm-pill crm-pill-con">Conge: {detailCounters.conge}</span>
                                              <span className="crm-pill" style={{ background: '#374151', color: '#fff' }}>{lang === 'en' ? 'Not clocked' : 'Non pointé'}: {detailCounters.non_pointe}</span>
                                            </div>

                                            <div className="crm-days-scroll">
                                              <table className="crm-days-table">
                                                <thead>
                                                  <tr>
                                                    <th>{lang === 'en' ? 'Date' : 'Date'}</th>
                                                    <th>{lang === 'en' ? 'Status' : 'Statut'}</th>
                                                    <th>Checkin</th>
                                                    <th>{lang === 'en' ? 'Late' : 'Retard'}</th>
                                                    <th>{lang === 'en' ? 'Not clocked' : 'Non pointé'}</th>
                                                    <th>Note</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {agentDetail.days.map((d) => (
                                                    <tr key={`${d.date}-${d.checkin_time ?? 'no-checkin'}`}>
                                                      <td>{formatDayLabel(d.date, locale)}</td>
                                                      <td>
                                                        <span className={`daily-status-label ${statusClass(d.status)}`}>
                                                          {statusLabel(d.status)}
                                                        </span>
                                                      </td>
                                                      <td>{formatCheckinHHMM(d) ?? '—'}</td>
                                                      <td>
                                                        {isRetardDay(d, effectiveThreshold) ? (
                                                          <span className="crm-retard-badge crm-retard-badge--yes">{lang === 'en' ? 'Yes' : 'Oui'}</span>
                                                        ) : (
                                                          <span className="crm-retard-badge crm-retard-badge--no">{lang === 'en' ? 'No' : 'Non'}</span>
                                                        )}
                                                      </td>
                                                      <td>
                                                        {(() => {
                                                          const key = normalizeStatus(d.status)
                                                          const isNP = !resolveCheckinTime(d) && key !== 'absent' && key !== 'conge'
                                                          return isNP
                                                            ? <span className="crm-retard-badge crm-retard-badge--yes">{lang === 'en' ? 'Yes' : 'Oui'}</span>
                                                            : <span className="crm-retard-badge crm-retard-badge--no">{lang === 'en' ? 'No' : 'Non'}</span>
                                                        })()}
                                                      </td>
                                                      <td>{d.note ?? '—'}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                                </React.Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  )
                })
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

export default CrmRecap
