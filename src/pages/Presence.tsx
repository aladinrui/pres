import React, { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { logout } from '../features/auth/authSlice'
import {
  BUSINESS_TIME_ZONE,
  formatIsoTimeInBusinessTZ,
  getBusinessNowDate,
  toBusinessYearMonth,
} from '../utils/businessTime'
import { useLang, getJours, getJoursCourt, getMois } from '../utils/i18n'

const API = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000') + '/api'

type PresenceLog = {
  id: number
  user_id: number
  username: string
  bureau_id: number
  profil: string
  type: 'in' | 'out'
  timestamp: string  // Always UTC (backend must ensure this)
  ip_address: string | null
  note: string | null
  created_at: string
}

type PresenceDaily = {
  id: number
  user_id: number
  username: string
  bureau_id: number
  profil: string
  date: string
  status: 'present' | 'absent' | 'partial' | 'conge'
  note: string | null
  created_at: string
  updated_at: string | null
}

type TodayData = {
  daily: PresenceDaily | null
  logs: PresenceLog[]
  last_action: 'in' | 'out' | null
}

type WeekData = {
  week: PresenceDaily[]
  from: string
  to: string
}

type MonthLog = {
  type: 'in' | 'out'
  timestamp: string
  note: string | null
}

type MonthDay = {
  id: number
  date: string
  status: PresenceDaily['status']
  note: string | null
  logs: MonthLog[]
  last_action: 'in' | 'out' | null
}

type MonthData = {
  user_id: number
  summary: {
    month: string
    days_present: number
    total_checkin: number
    total_checkout: number
  }
  days: MonthDay[]
}

const formatTime = (isoString: string): string => {
  return formatIsoTimeInBusinessTZ(isoString, true)
}

const formatFullDate = (now: Date, jours: string[], mois: string[]): string => {
  return `${jours[now.getDay()]} ${now.getDate()} ${mois[now.getMonth()]} ${now.getFullYear()}`
}

const Presence: React.FC = () => {
  const dispatch = useAppDispatch()
  const userDetail = useAppSelector((s) => s.user.userDetail)
  const lang = useLang()
  const JOURS = getJours(lang)
  const JOURS_COURT = getJoursCourt(lang)
  const MOIS = getMois(lang)

  const [now, setNow] = useState(getBusinessNowDate())
  const [todayData, setTodayData] = useState<TodayData | null>(null)
  const [weekData, setWeekData] = useState<WeekData | null>(null)
  const [loading, setLoading] = useState(true)
  const [weekLoading, setWeekLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Panneau droit : semaine ou mois
  const [activePanel, setActivePanel] = useState<'week' | 'month'>('week')
  const [monthData, setMonthData] = useState<MonthData | null>(null)
  const [monthLoading, setMonthLoading] = useState(false)
  const [monthYM, setMonthYM] = useState<string>(toYearMonthLocal(now)) // YYYY-MM
  const [expandedDay, setExpandedDay] = useState<number | null>(null)

  // Horloge temps réel
  useEffect(() => {
    const timer = setInterval(() => setNow(getBusinessNowDate()), 1000)
    return () => clearInterval(timer)
  }, [])

  const userId = userDetail?.userId
  const username = userDetail?.username ?? ''
  const bureauId = userDetail?.bureau_id ?? (userDetail?.bureaux?.[0] as any)?.id ?? 0
  const profil = (userDetail?.profil as string) ?? ''
  const profileLower = profil.toLowerCase()
  const canOpenCrmRecap = ['man', 'manager', 'crm_manager', 'crm manager', 'admin', 'superadmin'].includes(profileLower)
    && userDetail?.tenant !== 'tod'

  const fetchToday = useCallback(async () => {
    if (!userId) return
    try {
      setLoading(true)
      setError(null)
      const res = await axios.get<TodayData>(`${API}/presence/today/${userId}`)
      setTodayData(res.data)
    } catch (err: any) {
      setError(err?.response?.data?.message || (lang === 'en' ? 'Loading error' : 'Erreur lors du chargement'))
    } finally {
      setLoading(false)
    }
  }, [userId])

  const fetchWeek = useCallback(async () => {
    if (!userId) return
    try {
      setWeekLoading(true)
      const res = await axios.get<WeekData>(`${API}/presence/week/${userId}`)
      setWeekData(res.data)
    } catch {
      // silencieux — la semaine est un affichage secondaire
    } finally {
      setWeekLoading(false)
    }
  }, [userId])

  const fetchMonth = useCallback(async (ym: string) => {
    if (!userId) return
    try {
      setMonthLoading(true)
      const res = await axios.get<MonthData>(`${API}/presence/user/${userId}/month?month=${ym}`)
      setMonthData(res.data)
    } catch {
      // silencieux
    } finally {
      setMonthLoading(false)
    }
  }, [userId])

  useEffect(() => {
    fetchToday()
    fetchWeek()
    fetchMonth(monthYM) // toujours charger le mois courant dès le démarrage
  }, [fetchToday, fetchWeek]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activePanel === 'month') fetchMonth(monthYM)
  }, [activePanel, monthYM, fetchMonth])

  const goMonth = (n: number) => {
    const [y, m] = monthYM.split('-').map(Number)
    const d = new Date(y, m - 1 + n, 1)
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const currentYM = toBusinessYearMonth()
    if (next > currentYM) return
    setMonthYM(next)
    setExpandedDay(null)
  }

  const handleCheckin = async () => {
    if (!userId) return
    setActionLoading(true)
    setError(null)
    try {
      await axios.post(`${API}/presence/checkin`, {
        user_id: userId,
        username,
        bureau_id: bureauId,
        profil,
        // Backend MUST store timestamp as UTC, never influenced by client timezone
      })
      await fetchToday()
      await fetchWeek()
    } catch (err: any) {
      setError(err?.response?.data?.message || (lang === 'en' ? 'Check-in error' : 'Erreur lors du pointage IN'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleCheckout = async () => {
    if (!userId) return
    setActionLoading(true)
    setError(null)
    try {
      await axios.post(`${API}/presence/checkout`, {
        user_id: userId,
        username,
        bureau_id: bureauId,
        profil,
        // Backend MUST store timestamp as UTC, never influenced by client timezone
      })
      await fetchToday()
      await fetchWeek()
    } catch (err: any) {
      setError(err?.response?.data?.message || (lang === 'en' ? 'Check-out error' : 'Erreur lors du pointage OUT'))
    } finally {
      setActionLoading(false)
    }
  }

  const handleLogout = () => {
    dispatch(logout())
  }

  const lastAction = todayData?.last_action ?? null
  const isIn = lastAction === 'in'

  const todayLogs = todayData?.logs ?? []

  return (
    <div className="presence-page">
      {/* Header */}
      <header className="presence-header">
        <div className="header-left">
          <span className="header-logo">⏱</span>
          <span className="header-title">{lang === 'en' ? 'Attendance' : 'Pointage'}</span>
        </div>
        <div className="header-right">
          <span className="header-user">
            <span className="header-username">{username}</span>
            {profil && <span className="header-badge">{profil}</span>}
          </span>
          {['manager', 'man', 'crm_manager', 'crm manager', 'admin', 'superadmin'].includes(profileLower) && (
            <>
              {['admin', 'superadmin'].includes(profileLower)
                ? <Link to="/manager" className="btn-manager-link">{lang === 'en' ? '📊 Overview' : '📊 Général'}</Link>
                : <span className="btn-manager-link btn-manager-link--active">⏱ {lang === 'en' ? 'Clock' : 'Pointer'}</span>
              }
              <Link to="/manager/day" className="btn-manager-link">{lang === 'en' ? '📅 Day View' : '📅 Journée'}</Link>
              <Link to="/manager/agents" className="btn-manager-link">👥 Agents</Link>
              {canOpenCrmRecap && <Link to="/manager/crm-recap" className="btn-manager-link">{lang === 'en' ? '📈 CRM Recap' : '📈 CRM Récap'}</Link>}
            </>
          )}
          <button className="btn-logout" onClick={handleLogout}>{lang === 'en' ? 'Logout' : 'Déconnexion'}</button>
        </div>
      </header>

      <div className="presence-layout">
        {/* Colonne gauche — pointage */}
        <main className="presence-main">
          {/* Horloge */}
          <section className="clock-section">
            <div className="clock-date">{formatFullDate(now, JOURS, MOIS)}</div>
            <div className="clock-time">
              {now.toLocaleTimeString(lang === 'en' ? 'en-US' : 'fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="clock-week">
              {lang === 'en' ? `Week ${getWeekNumber(now)} — Day ${getDayOfYear(now)} of the year` : `Semaine ${getWeekNumber(now)} — Jour ${getDayOfYear(now)} de l'année`}
            </div>
          </section>

          {error && <div className="alert-error">{error}</div>}

          {loading ? (
            <div className="loading-state">{lang === 'en' ? 'Loading...' : 'Chargement...'}</div>
          ) : (
            <>
              {/* Statut actuel */}
              <section className="status-section">
                <div className={`status-badge ${isIn ? 'status-in' : 'status-out'}`}>
                  <span className="status-dot" />
                  {isIn
                    ? (lang === 'en' ? 'PRESENT' : 'PRÉSENT')
                    : lastAction === 'out'
                      ? (lang === 'en' ? 'CLOCKED OUT' : 'SORTI')
                      : (lang === 'en' ? 'NOT CLOCKED IN' : 'PAS ENCORE POINTÉ')}
                </div>
                {/* N'afficher le statut daily que s'il apporte une info supplémentaire (partiel, congé, absent) */}
                {todayData?.daily && !['present'].includes(todayData.daily.status) && (
                  <div className="status-daily-info">
                    <span className={`daily-status-label status-${todayData.daily.status}`}>
                      {statusLabel(todayData.daily.status)}
                    </span>
                  </div>
                )}
              </section>

              {/* Bouton IN / OUT */}
              <section className="action-section">
                {!isIn ? (
                  <button
                    className="btn-checkin"
                    onClick={handleCheckin}
                    disabled={actionLoading}
                  >
                    {actionLoading ? '...' : (lang === 'en' ? '▶ Clock IN' : '▶ Pointer ARRIVÉE')}
                  </button>
                ) : (
                  <button
                    className="btn-checkout"
                    onClick={handleCheckout}
                    disabled={actionLoading}
                  >
                    {actionLoading ? '...' : (lang === 'en' ? '■ Clock OUT' : '■ Pointer DÉPART')}
                  </button>
                )}
              </section>

              {/* Message du manager */}
              {todayData?.daily?.note && (
                <section className="manager-note-section">
                  <div className="manager-note-label">{lang === 'en' ? '📌 Manager note' : '📌 Message du manager'}</div>
                  <p className="manager-note-text">{todayData.daily.note}</p>
                </section>
              )}

              {/* Historique du jour */}
              <section className="logs-section">
                <h3>{lang === 'en' ? "Today's records" : "Pointages d'aujourd'hui"}</h3>
                {todayLogs.length === 0 ? (
                  <p className="logs-empty">{lang === 'en' ? 'No records today' : "Aucun pointage enregistré aujourd'hui"}</p>
                ) : (
                  <ul className="logs-list">
                    {todayLogs.map((log) => (
                      <li key={log.id} className={`log-item log-${log.type}`}>
                        <div className="log-item-left">
                          <span className={`log-type-badge log-type-${log.type}`}>
                            {log.type === 'in' ? (lang === 'en' ? '▶ IN' : '▶ ARRIVÉE') : (lang === 'en' ? '■ OUT' : '■ DÉPART')}
                          </span>
                          <span className="log-time">{formatTime(log.timestamp)}</span>
                        </div>
                        <div className="log-item-right">
                          {log.note && <span className="log-note">{log.note}</span>}
                          {log.ip_address && (
                            <span className="log-ip">{log.ip_address}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </main>

        {/* Colonne droite — semaine / mois */}
        <aside className="week-panel">

          {/* Onglets */}
          <div className="panel-tabs">
            <button
              className={`panel-tab ${activePanel === 'week' ? 'panel-tab--active' : ''}`}
              onClick={() => setActivePanel('week')}
            >
              {lang === 'en' ? 'Week' : 'Semaine'}
            </button>
            <button
              className={`panel-tab ${activePanel === 'month' ? 'panel-tab--active' : ''}`}
              onClick={() => setActivePanel('month')}
            >
              {lang === 'en' ? 'Month' : 'Mois'}
            </button>
          </div>

          {/* ── VUE SEMAINE ─────────────────────────────── */}
          {activePanel === 'week' && (
            <>
              <div className="week-panel-header">
                <h2>{lang === 'en' ? `Week ${getWeekNumber(now)}` : `Semaine ${getWeekNumber(now)}`}</h2>
                {weekData && (
                  <span className="week-range">
                    {formatShortDate(weekData.from, MOIS)} → {formatShortDate(weekData.to, MOIS)}
                  </span>
                )}
              </div>

              {weekLoading ? (
                <div className="week-loading">{lang === 'en' ? 'Loading...' : 'Chargement...'}</div>
              ) : (
                <ul className="week-list">
                  {getWeekDays(now).map(({ date, dayIndex }) => {
                    const iso = toISODate(date)
                    const entry = weekData?.week.find((d) => d.date === iso) ?? null
                    const isToday = iso === toISODate(now)
                    // Pour aujourd'hui : si pas de daily mais pointage en cours, afficher l'état live
                    const liveStatus = isToday && !entry && todayData?.last_action
                      ? (todayData.last_action === 'in' ? 'present' : 'partial') as PresenceDaily['status']
                      : null
                    const displayStatus = entry?.status ?? liveStatus

                    // Logs du jour depuis monthData (ou todayData pour aujourd'hui)
                    const dayLogs = isToday
                      ? (todayData?.logs ?? [])
                      : (monthData?.days.find((d) => d.date === iso)?.logs ?? [])
                    const firstIn  = dayLogs.filter((l) => l.type === 'in').sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0]
                    const lastOut  = dayLogs.filter((l) => l.type === 'out').sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]

                    return (
                      <li key={iso} className={`week-day${isToday ? ' week-day--today' : ''}`}>
                        <div className="week-day-left">
                          <span className="week-day-name">{JOURS_COURT[dayIndex]}</span>
                          <span className="week-day-num">{date.getDate()}</span>
                        </div>
                        <div className="week-day-center">
                          {displayStatus ? (
                            <>
                              <span className={`week-status-dot ws-${displayStatus}`} />
                              <span className={`week-status-text ws-text-${displayStatus}`}>
                                {statusLabel(displayStatus, lang)}
                                {liveStatus && <span className="week-live-dot" title={lang === 'en' ? 'In progress' : 'En cours'} />}
                              </span>
                            </>
                          ) : date > now ? (
                            <span className="week-status-future">—</span>
                          ) : (
                            <span className="week-status-missing">{lang === 'en' ? 'Not set' : 'Non renseigné'}</span>
                          )}
                          {firstIn && <span className="week-time week-time-in">▶ {formatTime(firstIn.timestamp)}</span>}
                          {lastOut && <span className="week-time week-time-out">■ {formatTime(lastOut.timestamp)}</span>}
                        </div>
                        <div className="week-day-right">
                          {entry?.note && (
                            <span className="week-day-note" title={entry.note}>📝</span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}

              {!weekLoading && weekData && (
                <div className="week-summary">
                  <div className="week-summary-item">
                    <span className="ws-count ws-count-present">{weekData.week.filter((d) => d.status === 'present').length}</span>
                    <span>{lang === 'en' ? 'Present' : 'Présent'}</span>
                  </div>
                  <div className="week-summary-item">
                    <span className="ws-count ws-count-absent">{weekData.week.filter((d) => d.status === 'absent').length}</span>
                    <span>Absent</span>
                  </div>
                  <div className="week-summary-item">
                    <span className="ws-count ws-count-conge">{weekData.week.filter((d) => d.status === 'conge').length}</span>
                    <span>{lang === 'en' ? 'Leave' : 'Congé'}</span>
                  </div>
                  <div className="week-summary-item">
                    <span className="ws-count ws-count-partial">{weekData.week.filter((d) => d.status === 'partial').length}</span>
                    <span>{lang === 'en' ? 'Partial' : 'Partiel'}</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── VUE MOIS ────────────────────────────────── */}
          {activePanel === 'month' && (
            <>
              {/* Navigation mois */}
              <div className="month-nav">
                <button className="date-nav-btn" onClick={() => goMonth(-1)}>&#8249;</button>
                <span className="month-nav-label">{formatMonthLabel(monthYM, MOIS)}</span>
                <button
                  className="date-nav-btn"
                  onClick={() => goMonth(1)}
                  disabled={monthYM >= toBusinessYearMonth()}
                >&#8250;</button>
              </div>

              {/* Résumé */}
              {monthData && (
                <div className="month-summary">
                  <div className="month-stat">
                    <span className="month-stat-num" style={{ color: '#22c55e' }}>{monthData.summary.days_present}</span>
                    <span className="month-stat-label">{lang === 'en' ? 'Days present' : 'Jours présent'}</span>
                  </div>
                  <div className="month-stat">
                    <span className="month-stat-num" style={{ color: 'var(--color-accent)' }}>{monthData.summary.total_checkin}</span>
                    <span className="month-stat-label">{lang === 'en' ? 'Check-ins' : 'Arrivées'}</span>
                  </div>
                  <div className="month-stat">
                    <span className="month-stat-num" style={{ color: 'var(--color-text-muted)' }}>{monthData.summary.total_checkout}</span>
                    <span className="month-stat-label">{lang === 'en' ? 'Check-outs' : 'Départs'}</span>
                  </div>
                </div>
              )}

              {monthLoading ? (
                <div className="week-loading">{lang === 'en' ? 'Loading...' : 'Chargement...'}</div>
              ) : (
                <ul className="month-day-list">
                  {(monthData?.days ?? []).map((day) => (
                    <li key={day.id} className="month-day-item">
                      <button
                        className="month-day-header"
                        onClick={() => setExpandedDay(expandedDay === day.id ? null : day.id)}
                      >
                        <div className="month-day-left">
                          <span className="month-day-date">{formatDayShort(day.date, JOURS_COURT)}</span>
                          <span className={`week-status-dot ws-${day.status}`} />
                          {/* Heures arrivée / départ visibles d'un coup d'oeil */}
                          {(() => {
                            const firstIn  = day.logs.filter((l) => l.type === 'in').sort((a, b) => a.timestamp.localeCompare(b.timestamp))[0]
                            const lastOut  = day.logs.filter((l) => l.type === 'out').sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]
                            return (
                              <div className="month-day-inline-times">
                                {firstIn  && <span className="week-time week-time-in">▶ {formatTime(firstIn.timestamp)}</span>}
                                {lastOut  && <span className="week-time week-time-out">■ {formatTime(lastOut.timestamp)}</span>}
                                {!firstIn && !lastOut && <span className={`ws-text-${day.status}`} style={{ fontSize: '0.78rem' }}>{statusLabel(day.status, lang)}</span>}
                              </div>
                            )
                          })()}
                        </div>
                        <div className="month-day-right">
                          {day.note && <span title={day.note}>📌</span>}
                          {day.logs.length > 0 && <span className="month-day-chevron">{expandedDay === day.id ? '▲' : '▼'}</span>}
                        </div>
                      </button>

                      {day.note && (
                        <div className="month-day-note">{day.note}</div>
                      )}

                      {expandedDay === day.id && day.logs.length > 0 && (
                        <ul className="month-logs-list">
                          {day.logs.map((log, i) => (
                            <li key={i} className={`month-log month-log-${log.type}`}>
                              <span className={`log-type-badge log-type-${log.type}`}>
                                {log.type === 'in' ? '▶' : '■'}
                              </span>
                              <span className="log-time">{formatTime(log.timestamp)}</span>
                              {log.note && <span className="log-note">{log.note}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                  {!monthLoading && monthData?.days.length === 0 && (
                    <li className="week-loading">{lang === 'en' ? 'No data this month' : 'Aucune donnée ce mois-ci'}</li>
                  )}
                </ul>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

// Utilitaires date précis
function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getDayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0)
  const diff = d.getTime() - start.getTime()
  return Math.floor(diff / 86400000)
}

function statusLabel(status: PresenceDaily['status'], lang: 'fr' | 'en' = 'fr'): string {
  const labels: Record<PresenceDaily['status'], { fr: string; en: string }> = {
    present: { fr: 'Présent',  en: 'Present' },
    absent:  { fr: 'Absent',   en: 'Absent'  },
    partial: { fr: 'Partiel',  en: 'Partial' },
    conge:   { fr: 'Congé',    en: 'Leave'   },
  }
  return labels[status]?.[lang] ?? status
}

// Retourne les 7 jours de la semaine ISO (lundi → dimanche) contenant `d`
function getWeekDays(d: Date): { date: Date; dayIndex: number }[] {
  const day = d.getDay() === 0 ? 7 : d.getDay() // ISO: lundi=1 ... dimanche=7
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day - 1))
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    return { date, dayIndex: date.getDay() }
  })
}

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function toYearMonthLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatShortDate(iso: string, mois: string[]): string {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getDate()} ${mois[d.getMonth()]}`
}

function formatMonthLabel(ym: string, mois: string[]): string {
  const [y, m] = ym.split('-').map(Number)
  return `${mois[m - 1]} ${y}`
}

function formatDayShort(iso: string, joursCourt: string[]): string {
  const d = new Date(iso + 'T00:00:00')
  return `${joursCourt[d.getDay()]} ${d.getDate()}`
}

export default Presence
