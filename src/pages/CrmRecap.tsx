import React, { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { logout } from '../features/auth/authSlice'
import { toBusinessISODate } from '../utils/businessTime'

const API = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000') + '/api'

const BUREAU_NAMES: Record<number, string> = {
  3: 'CRN',
  4: 'STV',
  5: 'MRO',
  6: 'SRG',
  7: 'YN',
  8: 'JC',
  9: 'PAST',
  10: 'PASC',
}

const ALL_BUREAU_IDS = Object.keys(BUREAU_NAMES).map(Number).sort((a, b) => a - b)

function bureauLabel(id: number): string {
  return BUREAU_NAMES[id] ? `${BUREAU_NAMES[id]} (${id})` : `Bureau ${id}`
}

type AgentRecap = {
  user_id: number
  username: string
  month: string
  absences_count: number
  retards_count: number
  conges_count: number
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
  return status
}

function statusClass(status: string): string {
  const key = normalizeStatus(status)
  if (key === 'present') return 'status-present'
  if (key === 'absent') return 'status-absent'
  if (key === 'conge') return 'status-conge'
  if (key === 'retard') return 'status-present'
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
  const match = raw.match(/(\d{2}):(\d{2})/)
  if (!match) return raw
  return `${match[1]}:${match[2]}`
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d
    .toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'short' })
    .replace('.', '')
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return ym
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
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
  const checkin = resolveCheckinTime(day)
  const checkinSec = timeToSeconds(checkin)
  const startSec = timeToSeconds(scheduleStart)
  if (checkinSec === null || startSec === null) return false
  return checkinSec > startSec
}

const CrmRecap: React.FC = () => {
  const dispatch = useAppDispatch()
  const userDetail = useAppSelector((s) => s.user.userDetail)

  const username = userDetail?.username ?? ''
  const profil = String(userDetail?.profil ?? '')
  const profileLower = profil.toLowerCase()
  const isAdmin = ['admin', 'superadmin'].includes(profileLower)

  // Bureaux gérés — même logique que ManagerDash / AgentMapList
  const myBureauId: number = userDetail?.bureau_id ?? (userDetail?.bureaux?.[0] as any)?.id ?? 0
  const managedBureauIds: number[] = useMemo(() => {
    return Array.from(new Set(
      (userDetail?.bureaux ?? [])
        .map((b: any) => Number(b?.id))
        .filter((id: number) => Number.isFinite(id) && id > 0)
    ))
  }, [userDetail?.bureaux])

  // Pour un admin : pas de filtre bureau côté API. Pour un crm_manager : son/ses bureaux
  const bureauIdsForApi: number[] = useMemo(() => {
    return isAdmin
      ? ALL_BUREAU_IDS
      : (managedBureauIds.length > 0 ? managedBureauIds : (myBureauId ? [myBureauId] : []))
  }, [isAdmin, managedBureauIds, myBureauId])

  const today = toBusinessISODate()
  const [dateTo, setDateTo] = useState<string>(today)
  const [dateFrom, setDateFrom] = useState<string>(addDaysToIsoDate(today, -30))

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
        bureau_name: BUREAU_NAMES[r.bureau_id],
        daterange: r.daterange,
        schedule_start: r.schedule_start,
        total_records: r.total_records,
        rows: r.data ?? [],
      }))

      setBureauxData(mapped)
    } catch (err: any) {
      const fallbackBureaux = bureauxToFetch.map((id) => ({
        bureau_id: id,
        bureau_name: BUREAU_NAMES[id],
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
      setLoading(false)
    }
  }, [API, bureauIdsForApi, dateFrom, dateTo, selectedBureau])

  useEffect(() => {
    fetchRecap()
  }, [fetchRecap])

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
      setAgentDetail(res.data)
    } catch (err: any) {
      setAgentDetail({ ...MOCK_AGENT_DETAIL, user_id: userId })
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
            const totalA = a.absences_count + a.retards_count + a.conges_count
            const totalB = b2.absences_count + b2.retards_count + b2.conges_count
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
    const base = { present: 0, absent: 0, conge: 0, retard: 0 }
    if (!agentDetail?.days) return base
    return agentDetail.days.reduce((acc, day) => {
      const key = normalizeStatus(day.status)
      if (key === 'present') acc.present += 1
      if (key === 'absent') acc.absent += 1
      if (key === 'conge') acc.conge += 1
      if (day.is_retard) acc.retard += 1
      return acc
    }, base)
  }, [agentDetail])

  return (
    <div className="presence-page">
      <header className="presence-header">
        <div className="header-left">
          <span className="header-logo">📈</span>
          <span className="header-title">Récap CRM — Congés / Absences / Retards</span>
        </div>
        <div className="header-right">
          <span className="header-user">
            <span className="header-username">{username}</span>
            {profil && <span className="header-badge">{profil}</span>}
          </span>

          {isAdmin ? (
            <>
              <Link to="/manager" className="btn-manager-link">📊 Général</Link>
              <Link to="/manager/day" className="btn-manager-link">📅 Journée</Link>
              <Link to="/manager/agents" className="btn-manager-link">👥 Agents</Link>
              <span className="btn-manager-link btn-manager-link--active">📈 CRM Récap</span>
            </>
          ) : (
            <>
              <Link to="/pointer" className="btn-manager-link">⏱ Pointer</Link>
              <Link to="/manager/day" className="btn-manager-link">📅 Journée</Link>
              <Link to="/manager/agents" className="btn-manager-link">👥 Agents</Link>
              <span className="btn-manager-link btn-manager-link--active">📈 CRM Récap</span>
            </>
          )}

          <button className="btn-logout" onClick={() => dispatch(logout())}>Déconnexion</button>
        </div>
      </header>

      <div className="manager-layout">
        <section className="crm-recap-top">
          <div>
            <h1 className="crm-recap-title">Synthèse par bureau et par agent</h1>
            <p className="crm-recap-subtitle">
              {dateFrom} → {dateTo}
            </p>
          </div>
        </section>

        {error && <div className="alert-error">{error}</div>}

        {loading ? (
          <div className="loading-state">Chargement du récap...</div>
        ) : (
          <>
            <section className="crm-toolbar">
              <div className="crm-toolbar-field">
                <label htmlFor="crm-bureau">Bureau</label>
                <select
                  id="crm-bureau"
                  className="bureau-select"
                  value={selectedBureau === 'all' ? 'all' : String(selectedBureau)}
                  onChange={(e) => {
                    setSelectedBureau(e.target.value === 'all' ? 'all' : Number(e.target.value))
                  }}
                >
                  {/* Admin voit "Tous" + chaque bureau. CRM manager voit uniquement ses bureaux */}
                  {isAdmin && <option value="all">Tous les bureaux</option>}
                  {availableBureaux.map((id) => (
                    <option key={id} value={id}>
                      {bureauLabel(id)}
                    </option>
                  ))}
                  {/* Si plusieurs bureaux assignés au manager, "Tous ses bureaux" apparaît aussi */}
                  {!isAdmin && bureauIdsForApi.length > 1 && (
                    <option value="all">Tous mes bureaux</option>
                  )}
                </select>
              </div>

              <div className="crm-toolbar-field">
                <label htmlFor="crm-from">Du</label>
                <input
                  id="crm-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>

              <div className="crm-toolbar-field">
                <label htmlFor="crm-to">Au</label>
                <input
                  id="crm-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>

              <div className="crm-toolbar-field crm-toolbar-field-search">
                <label htmlFor="crm-search">Agent / Profil</label>
                <input
                  id="crm-search"
                  type="text"
                  placeholder="Ex: CARON, agent, manager..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <button className="btn-refresh" onClick={fetchRecap}>Rafraîchir</button>
            </section>

            <section className="crm-bureaux-list">
              {visibleBureaux.length === 0 ? (
                <div className="week-loading">Aucune donnée pour ce filtre.</div>
              ) : (
                visibleBureaux.map((bureau) => {
                  const bAbs = bureau.rows.reduce((acc, a) => acc + a.absences_count, 0)
                  const bRet = bureau.rows.reduce((acc, a) => acc + a.retards_count, 0)
                  const bCon = bureau.rows.reduce((acc, a) => acc + a.conges_count, 0)

                  return (
                    <article key={bureau.bureau_id} className="crm-bureau-card">
                      <div className="crm-bureau-head">
                        <h2>{bureau.bureau_name ? `${bureau.bureau_name} (${bureau.bureau_id})` : bureauLabel(bureau.bureau_id)}</h2>
                        <div className="crm-bureau-stats">
                          <span>{bureau.total_records} lignes</span>
                          <span>Seuil: {bureau.schedule_start}</span>
                          <span className="crm-pill crm-pill-abs">Abs: {bAbs}</span>
                          <span className="crm-pill crm-pill-ret">Ret: {bRet}</span>
                          <span className="crm-pill crm-pill-con">Congé: {bCon}</span>
                        </div>
                      </div>

                      <div className="crm-table-wrap">
                        <table className="crm-table">
                          <thead>
                            <tr>
                              <th>Agent</th>
                              <th>Mois</th>
                              <th>Absences</th>
                              <th>Retards</th>
                              <th>Congés</th>
                              <th>Total alertes</th>
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
                                  <td>{formatMonthLabel(row.month)}</td>
                                  <td>{row.absences_count}</td>
                                  <td>{row.retards_count}</td>
                                  <td>{row.conges_count}</td>
                                  <td><strong>{total}</strong></td>
                                </tr>
                                {isOpen && (
                                  <tr className="crm-detail-row">
                                    <td colSpan={6}>
                                      <div className="crm-detail-panel">
                                        {detailLoading && <div className="week-loading">Chargement du détail agent...</div>}
                                        {detailError && <div className="alert-error">{detailError}</div>}

                                        {!detailLoading && agentDetail && (
                                          <>
                                            <div className="crm-detail-head">
                                              <div>
                                                <h3>{agentDetail.username}</h3>
                                              </div>
                                              <div className="crm-detail-meta">
                                                <span>Seuil: {agentDetail.schedule_start}</span>
                                                <span>Total jours: {agentDetail.total_days}</span>
                                              </div>
                                            </div>

                                            <div className="crm-detail-counters">
                                              <span className="crm-pill">Present: {detailCounters.present}</span>
                                              <span className="crm-pill crm-pill-abs">Absent: {detailCounters.absent}</span>
                                              <span className="crm-pill crm-pill-ret">Retard: {detailCounters.retard}</span>
                                              <span className="crm-pill crm-pill-con">Conge: {detailCounters.conge}</span>
                                            </div>

                                            <div className="crm-days-scroll">
                                              <table className="crm-days-table">
                                                <thead>
                                                  <tr>
                                                    <th>Date</th>
                                                    <th>Statut</th>
                                                    <th>Checkin</th>
                                                    <th>Retard</th>
                                                    <th>Note</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {agentDetail.days.map((d) => (
                                                    <tr key={`${d.date}-${d.checkin_time ?? 'no-checkin'}`}>
                                                      <td>{formatDayLabel(d.date)}</td>
                                                      <td>
                                                        <span className={`daily-status-label ${statusClass(d.status)}`}>
                                                          {statusLabel(d.status)}
                                                        </span>
                                                      </td>
                                                      <td>{formatCheckinHHMM(d) ?? '—'}</td>
                                                      <td>
                                                        {isRetardDay(d, agentDetail.schedule_start) ? (
                                                          <span className="crm-retard-badge crm-retard-badge--yes">Oui</span>
                                                        ) : (
                                                          <span className="crm-retard-badge crm-retard-badge--no">Non</span>
                                                        )}
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
