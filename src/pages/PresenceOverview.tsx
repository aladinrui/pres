import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { logout } from '../features/auth/authSlice'
import {
  fetchBureauDay,
  fetchAlerts,
  fetchAllBureauxData,
  setSelectedDate,
  setThreshold,
  type UserDay,
} from '../features/presence/presenceSlice'

const MOIS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
const JOURS = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']

const BUREAU_NAMES: Record<number, string> = {
  3:  'CRN',
  4:  'STV',
  5:  'MRO',
  6:  'SRG',
  7:  'YN',
  8:  'JC',
  9:  'PAST',
  10: 'PASC',
}
function bureauLabel(id: number) { return BUREAU_NAMES[id] ? `${BUREAU_NAMES[id]} (${id})` : `Bureau ${id}` }

const PROFIL_LABEL: Record<string, string> = {
  ret:         'R',
  agent:       'R',
  sup:         'S',
  support:     'S',
  man:         'M',
  manager:     'M',
  cm:          'CM',
  crm_manager: 'CM',
  'crm manager': 'CM',
}
function profilLabel(p: string | null | undefined) {
  if (!p) return null
  return PROFIL_LABEL[p] ?? p
}


// ── Helpers ────────────────────────────────────────────────────────────────

function todayISO() { return new Date().toISOString().slice(0, 10) }

function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function formatDateFR(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`
}

function addOffset(d: Date): Date { return new Date(d.getTime() + 3 * 60 * 60 * 1000) }

/** Force UTC parsing d'un timestamp ISO/MySQL — "2026-04-28 07:15:22" → Date UTC */
function parseUTC(ts: string): Date {
  return new Date(ts.replace(' ', 'T').replace(/([^Z])$/, '$1Z'))
}

function formatTime(iso: string) {
  return addOffset(parseUTC(iso)).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

/** Formate "HH:MM:SS" en "HH:MM" */
function formatHHMM(t: string | null | undefined): string | null {
  if (!t) return null
  return t.slice(0, 5)
}

/** Compare "HH:MM:SS" UTC au seuil "HH:MM" local — applique +3h avant comparaison */
function isCheckinLate(checkinTime: string | null | undefined, threshold: string): boolean {
  if (!checkinTime) return false
  const [h, m] = checkinTime.split(':').map(Number)
  const localMinutes = (h * 60 + m + 180) % (24 * 60) // UTC → +3h local
  const localHHMM = `${String(Math.floor(localMinutes / 60)).padStart(2, '0')}:${String(localMinutes % 60).padStart(2, '0')}`
  return localHHMM > threshold
}

/** Retourne l'heure du 1er pointage IN, ou null */
function firstCheckin(user: UserDay): string | null {
  const ins = user.logs.filter((l) => l.type === 'in').sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return ins.length > 0 ? ins[0].timestamp : null
}

/** true si l'heure de premier IN dépasse le seuil hh:mm (comparaison en heure locale affichée) */
function isLateByTime(user: UserDay, threshold: string): boolean {
  const ci = firstCheckin(user)
  if (!ci) return false
  const localTime = addOffset(parseUTC(ci))
  const hhmm = localTime.toISOString().slice(11, 16)
  return hhmm > threshold
}

type AlertKind = 'absent' | 'late-status' | 'late-time' | 'present-late' | 'ok' | 'conge' | 'not-checked'

function getAlertKind(user: UserDay, threshold: string, _date?: string): AlertKind {
  if (user.status === 'conge') return 'conge'
  if (user.status === 'absent') return 'absent'
  if (isLateByTime(user, threshold)) {
    if (user.last_action === 'in' || user.status === 'present') return 'present-late'
    return 'late-time'
  }
  if (!user.last_action) return 'not-checked'
  return 'ok'
}

const KIND_META: Record<AlertKind, { label: string; color: string; priority: number }> = {
  absent:         { label: 'Absent',              color: '#ef4444', priority: 1 },
  'late-status':  { label: 'Partiel/Retard',      color: '#f59e0b', priority: 2 },
  'late-time':    { label: 'En retard',            color: '#fb923c', priority: 3 },
  'present-late': { label: 'Présent / En retard', color: '#4ade80', priority: 3 },
  'not-checked':  { label: 'Pas pointé',           color: '#6b7280', priority: 4 },
  conge:          { label: 'Congé',                color: '#818cf8', priority: 5 },
  ok:             { label: 'OK',                   color: '#22c55e', priority: 6 },
}

const ALERT_STATUS: Record<string, { label: string; color: string }> = {
  non_pointe: { label: 'Pas pointé', color: '#6b7280' },
  absent:     { label: 'Absent',     color: '#ef4444' },
  retard:     { label: 'Retard',     color: '#f59e0b' },
}

// ── Component ──────────────────────────────────────────────────────────────

const PresenceOverview: React.FC = () => {
  const dispatch = useAppDispatch()
  const userDetail = useAppSelector((s) => s.user.userDetail)

  const username  = userDetail?.username ?? ''
  const profil    = (userDetail?.profil as string) ?? ''
  const isAdmin   = profil === 'admin' || profil === 'superadmin'

  const BUREAU_IDS_ALL = [3, 4, 5, 6, 7, 8, 9, 10]

  // ── Redux state ─────────────────────────────────────────────────────────
  const {
    bureauDay,
    bureauDayLoading,
    bureauDayError,
    alerts,
    alertsLoading,
    alertsError,
    allBureauxData,
    selectedDate,
    threshold,
  } = useAppSelector((s) => s.presence)

  const isToday = selectedDate === todayISO()

  // ── Local UI-only state ──────────────────────────────────────────────────
  const [filter, setFilter]   = useState<'all' | 'issues'>('all')
  const [expandedBureauId, setExpandedBureauId]     = useState<number | null>(null)
  const [bureauLoadingId, setBureauLoadingId]       = useState<number | null>(null)
  const [bureauCardFilter, setBureauCardFilter]     = useState<Record<number, 'all' | 'non_pointe' | 'absent' | 'retard' | 'present-late'>>({})
  const [showPresent, setShowPresent]               = useState<Record<number, boolean>>({})

  const toggleCardFilter = (bureau_id: number, f: 'non_pointe' | 'absent' | 'retard' | 'present-late', e: React.MouseEvent) => {
    e.stopPropagation()
    setBureauCardFilter(prev => ({ ...prev, [bureau_id]: prev[bureau_id] === f ? 'all' : f }))
    if (expandedBureauId !== bureau_id) toggleBureau(bureau_id)
  }

  // ── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) dispatch(fetchBureauDay(selectedDate))
  }, [dispatch, selectedDate, isAdmin])

  useEffect(() => {
    dispatch(fetchAlerts())
  }, [dispatch])

  useEffect(() => {
    if (isAdmin) dispatch(fetchAllBureauxData())
  }, [dispatch, isAdmin])

  const toggleBureau = (bureau_id: number) => {
    if (expandedBureauId === bureau_id) { setExpandedBureauId(null); return }
    setExpandedBureauId(bureau_id)
  }

  const goDay = (n: number) => {
    const next = addDays(selectedDate, n)
    if (next > todayISO()) return
    dispatch(setSelectedDate(next))
  }

  // ── Manager computed ────────────────────────────────────────────────────
  const users: UserDay[] = bureauDay?.days?.[0]?.users ?? []
  const sorted = [...users].sort((a, b) =>
    KIND_META[getAlertKind(a, threshold, selectedDate)].priority -
    KIND_META[getAlertKind(b, threshold, selectedDate)].priority
  )
  const displayed = filter === 'issues'
    ? sorted.filter((u) => { const k = getAlertKind(u, threshold, selectedDate); return k !== 'ok' && k !== 'conge' })
    : sorted
  const cAbsent  = users.filter((u) => getAlertKind(u, threshold, selectedDate) === 'absent').length
  const cLate    = users.filter((u) => ['late-status','late-time','present-late'].includes(getAlertKind(u, threshold, selectedDate))).length
  const cOk      = users.filter((u) => getAlertKind(u, threshold, selectedDate) === 'ok').length
  const cNoCheck = users.filter((u) => getAlertKind(u, threshold, selectedDate) === 'not-checked').length

  // ── Alerts computed ─────────────────────────────────────────────────────
  const alertAgents     = alerts?.agents ?? []
  const cAlertNonPointe = alertAgents.filter((a) => a.status === 'non_pointe').length
  const cAlertAbsent    = alertAgents.filter((a) => a.status === 'absent').length
  const cAlertRetard    = alertAgents.filter((a) => a.status === 'retard').length
  const alertsByBureau  = alertAgents.reduce<Record<number, typeof alertAgents>>((acc, a) => {
    if (!acc[a.bureau_id]) acc[a.bureau_id] = []
    acc[a.bureau_id].push(a)
    return acc
  }, {})
  const bureauGroups = Object.entries(
    alertAgents.reduce<Record<number, typeof alertAgents>>((acc, a) => {
      if (!acc[a.bureau_id]) acc[a.bureau_id] = []
      acc[a.bureau_id].push(a)
      return acc
    }, {})
  ).map(([id, agents]) => ({ bureau_id: Number(id), agents })).sort((a, b) => a.bureau_id - b.bureau_id)

  return (
    <div className="presence-page">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="presence-header">
        <div className="header-left">
          <span className="header-logo">{isAdmin ? '📊' : '👁'}</span>
          <span className="header-title">{isAdmin ? 'Général' : "Vue d'ensemble"}</span>
        </div>
        <div className="header-right">
          <span className="header-user">
            <span className="header-username">{username}</span>
            {profil && <span className="header-badge">{profil}</span>}
          </span>
          {isAdmin ? (
            <>
              <span className="btn-manager-link btn-manager-link--active">📊 Général</span>
              <Link to="/manager/day" className="btn-manager-link">📅 Journée</Link>
              <Link to="/manager/agents" className="btn-manager-link">👥 Agents</Link>
            </>
          ) : (
            <>
              <Link to="/pointer" className="btn-manager-link">⏱ Pointer</Link>
              <Link to="/manager/day" className="btn-manager-link">📅 Journée</Link>
              <Link to="/manager/agents" className="btn-manager-link">👥 Agents</Link>
            </>
          )}
          <button className="btn-logout" onClick={() => dispatch(logout())}>Déconnexion</button>
        </div>
      </header>

      <div className="manager-layout">

        {/* ════════ VUE ADMIN — Général ════════════════════════════════════ */}
        {isAdmin && (
          <>
            <div className="general-section-header">
              <div>
                <span className="general-section-title">⚠️ Alertes du jour</span>
                <span className="general-section-date">{formatDateFR(todayISO())}</span>
              </div>
              <div className="threshold-control">
                <label htmlFor="threshold-admin">⏰ Seuil</label>
                <input
                  id="threshold-admin"
                  type="time"
                  className="threshold-input"
                  value={threshold}
                  onChange={(e) => dispatch(setThreshold(e.target.value))}
                />
              </div>
              <button
                className="btn-refresh"
                onClick={() => { dispatch(fetchAlerts()); dispatch(fetchAllBureauxData()) }}
                disabled={alertsLoading}
              >
                {alertsLoading ? '...' : '↻'}
              </button>
            </div>

            {alertsError && <div className="alert-error">{alertsError}</div>}

            {/* Chart % en service par bureau */}
            {Object.keys(allBureauxData).length > 0 && (
              <div className="bureau-chart-section">
                <span className="bureau-chart-title">% En service par bureau</span>
                <div className="bureau-chart-grid">
                  {BUREAU_IDS_ALL.map((bureau_id) => {
                    const agents  = (allBureauxData[bureau_id] ?? []).filter((a) => a.is_active !== 0 && a.is_active !== false)
                    const bAlerts = alertsByBureau[bureau_id] ?? []
                    const total   = agents.length
                    if (total === 0) return null
                    const today = todayISO()
                    type ES = 'non_pointe' | 'absent' | 'retard' | 'present-late' | 'present' | 'conge'
                    const sm = new Map<number, ES>()
                    // Construire map checkin_time depuis les alertes
                    const alertCheckinMap = new Map<number, string | null>()
                    bAlerts.forEach((a) => {
                      alertCheckinMap.set(a.user_id, a.checkin_time ?? null)
                      if (a.status === 'non_pointe' || a.status === 'absent') sm.set(a.user_id, a.status)
                      if (a.status === 'conge') sm.set(a.user_id, 'conge')
                    })
                    agents.forEach((ag) => {
                      if (ag.status === 'conge')                  { sm.set(ag.user_id, 'conge'); return }
                      if (sm.get(ag.user_id) === 'absent')        return
                      if (ag.last_action === 'in' || ag.status === 'present') {
                        const ct = alertCheckinMap.get(ag.user_id) ?? null
                        // Utiliser checkin_time de l'alerte si dispo, sinon fallback isLateByTime
                        const late = ct ? isCheckinLate(ct, threshold) : isLateByTime(ag, threshold)
                        if (late) { sm.set(ag.user_id, 'present-late'); return }
                        sm.set(ag.user_id, 'present'); return
                      }
                      // Sorti — vérifier retard via checkin_time ou logs
                      const ct = alertCheckinMap.get(ag.user_id) ?? null
                      const late = ct ? isCheckinLate(ct, threshold) : isLateByTime(ag, threshold)
                      if (late) { sm.set(ag.user_id, 'retard'); return }
                      if (!sm.has(ag.user_id)) sm.set(ag.user_id, 'non_pointe')
                    })
                    const vals       = [...sm.values()]
                    const nPres      = vals.filter((s) => s === 'present').length
                    const nPresLate  = vals.filter((s) => s === 'present-late').length
                    const nRet       = vals.filter((s) => s === 'retard').length
                    const nAbs       = vals.filter((s) => s === 'absent').length
                    const nConge     = vals.filter((s) => s === 'conge').length
                    const nNP        = vals.filter((s) => s === 'non_pointe').length
                    const pPres      = Math.round(nPres / total * 100)
                    const bName  = BUREAU_NAMES[bureau_id] ?? `B${bureau_id}`
                    return (
                      <div key={bureau_id} className="bureau-chart-row">
                        <span className="bureau-chart-label">{bName}</span>
                        <div className="bureau-chart-bar-track">
                          <div className="bureau-chart-bar-seg" style={{ width: `${Math.round(nPres     / total * 100)}%`, background: '#22c55e' }} />
                          <div className="bureau-chart-bar-seg" style={{ width: `${Math.round(nPresLate / total * 100)}%`, background: '#4ade80', opacity: 0.6 }} />
                          <div className="bureau-chart-bar-seg" style={{ width: `${Math.round(nRet      / total * 100)}%`, background: '#fb923c' }} />
                          <div className="bureau-chart-bar-seg" style={{ width: `${Math.round(nAbs      / total * 100)}%`, background: '#ef4444' }} />
                          <div className="bureau-chart-bar-seg" style={{ width: `${Math.round(nConge    / total * 100)}%`, background: '#818cf8' }} />
                          <div className="bureau-chart-bar-seg" style={{ width: `${Math.round(nNP       / total * 100)}%`, background: '#374151' }} />
                        </div>
                        <span className="bureau-chart-pct">{pPres}%</span>
                        <span className="bureau-chart-detail">
                          <span style={{ color: '#4ade80' }}>{nPres}</span>
                          <span style={{ color: '#6b7280' }}>/{total}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="bureau-chart-legend">
                  <span className="bureau-chart-legend-item"><i style={{ background: '#22c55e' }} />Présent</span>
                  <span className="bureau-chart-legend-item"><i style={{ background: '#4ade80', opacity: 0.6 }} />Prés/Retard</span>
                  <span className="bureau-chart-legend-item"><i style={{ background: '#fb923c' }} />Retard</span>
                  <span className="bureau-chart-legend-item"><i style={{ background: '#ef4444' }} />Absent</span>
                  <span className="bureau-chart-legend-item"><i style={{ background: '#818cf8' }} />Congé</span>
                  <span className="bureau-chart-legend-item"><i style={{ background: '#374151' }} />NP</span>
                </div>
              </div>
            )}

            {/* Grille de cartes par bureau */}
            {alertsLoading ? (
              <div className="loading-state">Chargement...</div>
            ) : (
              <div className="bureaux-cards-grid">
                {BUREAU_IDS_ALL.map((bureau_id) => {
                  const bName      = BUREAU_NAMES[bureau_id] ?? `Bureau ${bureau_id}`
                  const bAlerts    = alertsByBureau[bureau_id] ?? []
                  const rawAgents  = (allBureauxData[bureau_id] ?? []).filter((a) => a.is_active !== 0 && a.is_active !== false)
                  const isExpanded = expandedBureauId === bureau_id
                  const isLoadingFull = bureauLoadingId === bureau_id
                  const activeFilter = bureauCardFilter[bureau_id] ?? 'all'

                  // Compteurs depuis API alerts (source de vérité)
                  const nbNP  = bAlerts.filter((a) => a.status === 'non_pointe').length
                  const nbAbs = bAlerts.filter((a) => a.status === 'absent').length

                  // Map user_id → statut enrichi : alerte API prioritaire, puis détection locale complète
                  type EnrichedStatus = 'non_pointe' | 'absent' | 'retard' | 'present-late' | 'present' | 'conge'
                  const statusMap = new Map<number, EnrichedStatus>()

                  // 1. NP, Absent, Congé depuis API
                  bAlerts.forEach((a) => {
                    if (a.status === 'non_pointe' || a.status === 'absent' || a.status === 'conge')
                      statusMap.set(a.user_id, a.status)
                  })

                  // Map checkin_time depuis alertes
                  const alertCheckinMap = new Map<number, string | null>()
                  bAlerts.forEach((a) => alertCheckinMap.set(a.user_id, a.checkin_time ?? null))

                  // 2. Enrichissement local
                  const today = todayISO()
                  rawAgents.forEach((ag) => {
                    if (ag.status === 'conge')                              { statusMap.set(ag.user_id, 'conge');        return }
                    if (statusMap.get(ag.user_id) === 'absent')            return
                    if (ag.last_action === 'in' || ag.status === 'present') {
                      const ct = alertCheckinMap.get(ag.user_id) ?? null
                      const late = ct ? isCheckinLate(ct, threshold) : isLateByTime(ag, threshold)
                      if (late)                                              { statusMap.set(ag.user_id, 'present-late'); return }
                      statusMap.set(ag.user_id, 'present'); return
                    }
                    const ct = alertCheckinMap.get(ag.user_id) ?? null
                    const late = ct ? isCheckinLate(ct, threshold) : isLateByTime(ag, threshold)
                    if (late)                                                { statusMap.set(ag.user_id, 'retard');       return }
                    if (!statusMap.has(ag.user_id))                         statusMap.set(ag.user_id, 'non_pointe')
                  })

                  const nbRetPure  = [...statusMap.values()].filter((s) => s === 'retard').length
                  const nbPresLate = [...statusMap.values()].filter((s) => s === 'present-late').length
                  const nbRet      = nbRetPure + nbPresLate
                  const nbPres  = [...statusMap.values()].filter((s) => s === 'present').length
                  const nbConge = [...statusMap.values()].filter((s) => s === 'conge').length
                  const hasIssues = nbNP + nbAbs + nbRet > 0

                  const npIds       = new Set([...statusMap.entries()].filter(([,s]) => s === 'non_pointe').map(([id]) => id))
                  const absIds      = new Set([...statusMap.entries()].filter(([,s]) => s === 'absent').map(([id]) => id))
                  const retIds      = new Set([...statusMap.entries()].filter(([,s]) => s === 'retard').map(([id]) => id))
                  const presLateIds = new Set([...statusMap.entries()].filter(([,s]) => s === 'present-late').map(([id]) => id))

                  const fullAgents = activeFilter === 'all'           ? rawAgents
                    : activeFilter === 'non_pointe'  ? rawAgents.filter((ag) => npIds.has(ag.user_id))
                    : activeFilter === 'absent'      ? rawAgents.filter((ag) => absIds.has(ag.user_id))
                    : activeFilter === 'retard'      ? rawAgents.filter((ag) => retIds.has(ag.user_id))
                    : activeFilter === 'present-late'? rawAgents.filter((ag) => presLateIds.has(ag.user_id))
                    : rawAgents

                  return (
                    <div
                      key={bureau_id}
                      className={`bureau-card${isExpanded ? ' bureau-card--expanded' : ''}${hasIssues ? ' bureau-card--issues' : ''}`}
                    >
                      {/* En-tête cliquable */}
                      <div className="bureau-card-header" onClick={() => toggleBureau(bureau_id)}>
                        <div className="bureau-card-title">
                          <span className="bureau-card-name">{bName}</span>
                          {rawAgents.length > 0 && (
                            <span className="bureau-card-total">/{rawAgents.length}</span>
                          )}
                        </div>
                        <div className="bureau-card-stats">
                          {nbPres > 0 && (
                            <span className="bstat bstat--pres">
                              <span className="bstat-num">{nbPres}</span>
                              <span className="bstat-lbl">Prés</span>
                            </span>
                          )}
                          {nbPresLate > 0 && (
                            <button
                              className={`bstat bstat--pres-late${activeFilter === 'present-late' ? ' bstat--active' : ''}`}
                              onClick={(e) => toggleCardFilter(bureau_id, 'present-late', e)}
                            >
                              <span className="bstat-num">{nbPresLate}</span>
                              <span className="bstat-lbl">P/R</span>
                            </button>
                          )}
                          <button
                            className={`bstat bstat--ret${nbRetPure === 0 ? ' bstat--zero' : ''}${activeFilter === 'retard' ? ' bstat--active' : ''}`}
                            onClick={(e) => toggleCardFilter(bureau_id, 'retard', e)}
                          >
                            <span className="bstat-num">{nbRetPure}</span>
                            <span className="bstat-lbl">Ret</span>
                          </button>
                          <button
                            className={`bstat bstat--abs${nbAbs === 0 ? ' bstat--zero' : ''}${activeFilter === 'absent' ? ' bstat--active' : ''}`}
                            onClick={(e) => toggleCardFilter(bureau_id, 'absent', e)}
                          >
                            <span className="bstat-num">{nbAbs}</span>
                            <span className="bstat-lbl">Abs</span>
                          </button>
                          {nbConge > 0 && (
                            <span className="bstat bstat--conge">
                              <span className="bstat-num">{nbConge}</span>
                              <span className="bstat-lbl">Cong</span>
                            </span>
                          )}
                          <button
                            className={`bstat bstat--np${nbNP === 0 ? ' bstat--zero' : ''}${activeFilter === 'non_pointe' ? ' bstat--active' : ''}`}
                            onClick={(e) => toggleCardFilter(bureau_id, 'non_pointe', e)}
                          >
                            <span className="bstat-num">{nbNP}</span>
                            <span className="bstat-lbl">NP</span>
                          </button>
                        </div>
                        <span className="bureau-card-chevron">{isExpanded ? '▲' : '▼'}</span>
                      </div>

                      {/* Liste complète expandée */}
                      {isExpanded && (() => {
                        const isPresentShown = showPresent[bureau_id] ?? false
                        const displayedAgents = isPresentShown
                          ? fullAgents
                          : fullAgents.filter((ag) => {
                              const s = statusMap.get(ag.user_id) ?? 'present'
                              return s !== 'present' && s !== 'present-late'
                            })
                        const nbHidden = fullAgents.filter((ag) => {
                          const s = statusMap.get(ag.user_id) ?? 'present'
                          return s === 'present' || s === 'present-late'
                        }).length
                        return (
                        <div className="bureau-card-body">
                          {isLoadingFull ? (
                            <div className="loading-state" style={{ padding: '0.75rem' }}>Chargement...</div>
                          ) : displayedAgents.length === 0 && !isPresentShown ? (
                            <div className="agents-empty" style={{ padding: '0.75rem' }}>
                              Aucun problème
                              {nbHidden > 0 && (
                                <button
                                  className="btn-show-present"
                                  onClick={() => setShowPresent(prev => ({ ...prev, [bureau_id]: true }))}
                                >
                                  Voir {nbHidden} présent{nbHidden > 1 ? 's' : ''}
                                </button>
                              )}
                            </div>
                          ) : displayedAgents.length === 0 ? (
                            <div className="agents-empty" style={{ padding: '0.75rem' }}>Aucun agent</div>
                          ) : (
                            <div className="bureau-full-table">
                              <div className="bureau-full-head">
                                <span>Agent</span>
                                <span>Statut</span>
                                <span>Heure</span>
                                <span>Note</span>
                              </div>
                              {nbHidden > 0 && (
                                <div style={{ padding: '0.4rem 0.75rem', borderBottom: '1px solid #1e293b' }}>
                                  <button
                                    className="btn-show-present"
                                    onClick={() => setShowPresent(prev => ({ ...prev, [bureau_id]: !isPresentShown }))}
                                  >
                                    {isPresentShown ? `▲ Masquer les présents (${nbHidden})` : `▼ Voir ${nbHidden} présent${nbHidden > 1 ? 's' : ''}`}
                                  </button>
                                </div>
                              )}
                              {[...displayedAgents]
                                .sort((a, b) => {
                                  const order: Record<string, number> = { absent: 0, retard: 1, 'present-late': 2, non_pointe: 3, conge: 4, present: 5 }
                                  const sa = statusMap.get(a.user_id) ?? 'present'
                                  const sb = statusMap.get(b.user_id) ?? 'present'
                                  return (order[sa] ?? 6) - (order[sb] ?? 6)
                                })
                                .map((agent) => {
                                  const agStatus = statusMap.get(agent.user_id) ?? 'present'
                                  const ci = firstCheckin(agent)
                                  // Récupérer checkin_time et schedule_start depuis l'alerte
                                  const alertData = bAlerts.find((a) => a.user_id === agent.user_id)
                                  const checkinDisplay = alertData?.checkin_time
                                    ? formatHHMM(alertData.checkin_time)
                                    : ci ? formatTime(ci) : null
                                  const scheduleDisplay = formatHHMM(alertData?.schedule_start)
                                  // Forcer present-late au render si présent et checkin tardif
                                  const effectiveStatus = (agStatus === 'present' && (
                                    alertData?.checkin_time ? isCheckinLate(alertData.checkin_time, threshold)
                                      : (ci ? isLateByTime(agent, threshold) : false)
                                  )) ? 'present-late' : agStatus
                                  const sm: { label: string; color: string } =
                                    effectiveStatus === 'present-late' ? { label: 'Présent / En retard', color: '#4ade80' } :
                                    effectiveStatus === 'retard'       ? { label: 'En retard',            color: '#fb923c' } :
                                    effectiveStatus === 'absent'       ? { label: 'Absent',                color: '#ef4444' } :
                                    effectiveStatus === 'non_pointe'   ? { label: 'Pas pointé',            color: '#6b7280' } :
                                    effectiveStatus === 'conge'        ? { label: 'Congé',                 color: '#818cf8' } :
                                                                         { label: 'Présent',               color: '#22c55e' }
                                  return (
                                    <div key={agent.user_id} className="bureau-full-row">
                                      <div className="agent-info-line">
                                        <span className="agent-name">{agent.username}</span>
                                        {agent.profil && (
                                          <span className={`profil-tag profil-tag--${agent.profil}`}>{profilLabel(agent.profil)}</span>
                                        )}
                                      </div>
                                      <div>
                                        <span
                                          className="alerts-status-badge"
                                          style={{ background: sm.color + '22', color: sm.color, borderColor: sm.color + '55' }}
                                        >
                                          {sm.label}
                                        </span>
                                      </div>
                                      <div>
                                        {checkinDisplay
                                          ? (
                                            <span className="alerts-time">
                                              ▶ {checkinDisplay}
                                              {scheduleDisplay && (effectiveStatus === 'present-late' || effectiveStatus === 'retard') && (
                                                <span style={{ color: '#6b7280', fontSize: '0.75em', marginLeft: '0.4em' }}>prévu {scheduleDisplay}</span>
                                              )}
                                            </span>
                                          )
                                          : <span className="note-preview-empty">—</span>}
                                      </div>
                                      <div>
                                        {agent.note
                                          ? <span className="alerts-note-text">{agent.note}</span>
                                          : <span className="note-preview-empty">—</span>}
                                      </div>
                                    </div>
                                  )
                                })}
                            </div>
                          )}
                        </div>
                        )
                      })()}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ════════ VUE MANAGER — Bureau ═══════════════════════════════════ */}
        {!isAdmin && (
          <>
            {/* Toolbar */}
            <div className="overview-toolbar">
              <div className="date-nav">
                <button className="date-nav-btn" onClick={() => goDay(-1)}>‹</button>
                <div className="date-nav-center">
                  <span className="date-nav-label">{formatDateFR(selectedDate)}</span>
                  {!isToday && (
                    <button className="date-nav-today" onClick={() => setSelectedDate(todayISO())}>Aujourd'hui</button>
                  )}
                </div>
                <button className="date-nav-btn" onClick={() => goDay(1)} disabled={isToday}>›</button>
              </div>
              <div className="threshold-control">
                <label htmlFor="threshold">⏰ Seuil retard</label>
                <input id="threshold" type="time" className="threshold-input" value={threshold} onChange={(e) => dispatch(setThreshold(e.target.value))} />
              </div>
              <div className="agent-map-filters">
                <button className={`filter-btn ${filter === 'all' ? 'filter-btn--active' : ''}`} onClick={() => setFilter('all')}>Tous ({users.length})</button>
                <button className={`filter-btn ${filter === 'issues' ? 'filter-btn--active' : ''}`} onClick={() => setFilter('issues')}>⚠ Problèmes ({cAbsent + cLate + cNoCheck})</button>
              </div>
              <button className="btn-refresh" onClick={() => dispatch(fetchBureauDay(selectedDate))} disabled={bureauDayLoading}>{bureauDayLoading ? '...' : '↻'}</button>
            </div>

            {/* Alertes du jour (manager) */}
            <div className="alerts-section">
              <div className="alerts-section-header">
                <span className="alerts-section-title">⚠️ Alertes du jour</span>
                <span className="alerts-section-date">{formatDateFR(todayISO())}</span>
                <button className="btn-refresh" onClick={() => dispatch(fetchAlerts())} disabled={alertsLoading}>{alertsLoading ? '...' : '↻'}</button>
              </div>
              {alertsError && <div className="alert-error">{alertsError}</div>}
              <div className="alerts-counters">
                <div className="alert-stat alert-stat--non-pointe"><span className="alert-stat-num">{cAlertNonPointe}</span><span className="alert-stat-label">Pas pointé</span></div>
                <div className="alert-stat alert-stat--absent"><span className="alert-stat-num">{cAlertAbsent}</span><span className="alert-stat-label">Absent</span></div>
                <div className="alert-stat alert-stat--retard"><span className="alert-stat-num">{cAlertRetard}</span><span className="alert-stat-label">Retard</span></div>
              </div>
              {alertsLoading ? (
                <div className="loading-state">Chargement...</div>
              ) : bureauGroups.length === 0 ? (
                <div className="alerts-empty">✅ Aucune alerte pour aujourd'hui</div>
              ) : (
                <div className="alerts-bureaux">
                  {bureauGroups.map(({ bureau_id, agents }) => {
                    const bName = BUREAU_NAMES[bureau_id] ?? `Bureau ${bureau_id}`
                    const nbNP  = agents.filter((a) => a.status === 'non_pointe').length
                    const nbAbs = agents.filter((a) => a.status === 'absent').length
                    const nbRet = agents.filter((a) => a.status === 'retard').length
                    const sortedAgents = [...agents].sort((a, b) => {
                      const order: Record<string, number> = { absent: 0, retard: 1, non_pointe: 2 }
                      return (order[a.status] ?? 3) - (order[b.status] ?? 3)
                    })
                    return (
                      <div key={bureau_id} className="alerts-bureau-block">
                        <div className="alerts-bureau-header">
                          <span className="alerts-bureau-name">{bName}</span>
                          <div className="alerts-bureau-mini-stats">
                            {nbAbs > 0 && <span className="alerts-mini-stat alerts-mini-stat--absent">{nbAbs} absent{nbAbs > 1 ? 's' : ''}</span>}
                            {nbRet > 0 && <span className="alerts-mini-stat alerts-mini-stat--retard">{nbRet} retard{nbRet > 1 ? 's' : ''}</span>}
                            {nbNP  > 0 && <span className="alerts-mini-stat alerts-mini-stat--np">{nbNP} pas pointé{nbNP > 1 ? 's' : ''}</span>}
                          </div>
                        </div>
                        <div className="alerts-table">
                          <div className="alerts-table-head"><span>Agent</span><span>Statut</span><span>Note</span><span>Heure</span></div>
                          {sortedAgents.map((agent) => {
                            const sm = ALERT_STATUS[agent.status] ?? { label: agent.status, color: '#6b7280' }
                            return (
                              <div key={agent.user_id} className="alerts-table-row">
                                <div className="agent-info-line">
                                  <span className="agent-name">{agent.username}</span>
                                  {agent.profil && <span className={`profil-tag profil-tag--${agent.profil}`}>{profilLabel(agent.profil)}</span>}
                                </div>
                                <div><span className="alerts-status-badge" style={{ background: sm.color + '22', color: sm.color, borderColor: sm.color + '55' }}>{sm.label}</span></div>
                                <div>{agent.note ? <span className="alerts-note-text">{agent.note}</span> : <span className="note-preview-empty">—</span>}</div>
                                <div>{agent.updated_at ? <span className="alerts-time">{formatTime(agent.updated_at)}</span> : <span className="note-preview-empty">—</span>}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Compteurs */}
            <div className="manager-counters">
              <div className="counter-card counter-present"><span className="counter-num">{cOk}</span><span className="counter-label">À l'heure</span></div>
              <div className="counter-card" style={{ borderTop: '3px solid #fb923c' }}><span className="counter-num" style={{ color: '#fb923c' }}>{cLate}</span><span className="counter-label">En retard</span></div>
              <div className="counter-card counter-absent"><span className="counter-num">{cAbsent}</span><span className="counter-label">Absents</span></div>
              <div className="counter-card counter-waiting"><span className="counter-num">{cNoCheck}</span><span className="counter-label">Pas pointé</span></div>
            </div>

            {bureauDayError && <div className="alert-error">{bureauDayError}</div>}

            {bureauDayLoading ? (
              <div className="loading-state">Chargement...</div>
            ) : displayed.length === 0 ? (
              <div className="agents-empty">Aucun agent à afficher</div>
            ) : (
              <div className="overview-grid">
                {displayed.map((user) => {
                  const kind = getAlertKind(user, threshold, selectedDate)
                  const meta = KIND_META[kind]
                  const ci   = firstCheckin(user)
                  const isIssue = kind === 'absent' || kind === 'late-status' || kind === 'late-time' || kind === 'present-late'
                  return (
                    <div key={user.user_id} className={`overview-card ${isIssue ? 'overview-card--issue' : ''}`} style={{ '--card-color': meta.color } as React.CSSProperties}>
                      <div className="overview-card-bar" />
                      <div className="overview-card-body">
                        <div className="overview-card-top">
                          <div>
                            <span className="overview-agent-name">{user.username}</span>
                            {user.profil && <span className="agent-profil">{profilLabel(user.profil)}</span>}
                          </div>
                          <span className="overview-status-badge" style={{ background: meta.color + '22', color: meta.color, borderColor: meta.color + '55' }}>{meta.label}</span>
                        </div>
                        <div className="overview-card-mid">
                          {ci
                            ? <span className={`overview-checkin-time ${kind === 'late-time' ? 'overview-checkin-late' : ''}`}>▶ {formatTime(ci)}{kind === 'late-time' && <span className="late-flag">RETARD</span>}</span>
                            : <span className="overview-no-checkin">Aucun pointage</span>}
                        </div>
                        {(user.note || isIssue) && (
                          <div className="overview-note">
                            {user.note
                              ? <><span className="overview-note-icon">📌</span><span className="overview-note-text">{user.note}</span></>
                              : <span className="overview-note-empty">Aucune note</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default PresenceOverview
