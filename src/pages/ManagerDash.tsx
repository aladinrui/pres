import React, { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { logout } from '../features/auth/authSlice'
import { buildBureauNameMap } from '../utils/bureaux'
import {
  convertUtcHHMMToBusinessHHMM,
  formatTimeForBureau,
  toBusinessISODate,
  parseBackendTimestampToCairoMinutes,
} from '../utils/businessTime'
import { useLang, getMois, getJoursCourt } from '../utils/i18n'

const API = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000') + '/api'

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

// ── Types ──────────────────────────────────────────────────────────────────

type PresenceLog = {
  id: number
  type: 'in' | 'out'
  timestamp: string
  note: string | null
  ip_address: string | null
}

type UserDay = {
  user_id: number
  username: string
  profil?: string
  status: 'present' | 'absent' | 'partial' | 'retard' | 'conge' | null
  note: string | null
  daily_id: number | null
  logs: PresenceLog[]
  last_action: 'in' | 'out' | null
}

type DayEntry = {
  date: string
  users: UserDay[]
}

type BureauDayResponse = {
  bureau_id: number
  date_from: string
  date_to: string
  days: DayEntry[]
}

type ApiStatus = UserDay['status'] | 'retard'
type UiStatus = Exclude<ApiStatus, 'partial'>

function getStatusOptions(lang: 'fr' | 'en'): { value: UiStatus; label: string; color: string }[] {
  return [
    { value: 'absent',  label: 'Absent',                          color: '#ef4444' },
    { value: 'retard',  label: lang === 'en' ? 'Late' : 'Retard', color: '#fb923c' },
    { value: 'conge',   label: lang === 'en' ? 'Leave' : 'Cong\u00e9', color: '#818cf8' },
  ]
}

// ── Utils ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  return toBusinessISODate()
}

function formatDateFR(iso: string, jours: string[], mois: string[]): string {
  const d = new Date(iso + 'T00:00:00')
  return `${jours[d.getDay()]} ${d.getDate()} ${mois[d.getMonth()]} ${d.getFullYear()}`
}

function formatTime(iso: string, bId: number): string {
  return formatTimeForBureau(iso, bId)
}

/** Retourne le décalage entre une heure "HH:MM" et le seuil "HH:MM", ex: "+45min" ou "+1h15" */
function formatDelay(timeHHMM: string, threshold: string): string {
  const [th, tm] = threshold.split(':').map(Number)
  const [hh, mm] = timeHHMM.split(':').map(Number)
  const diff = (hh * 60 + mm) - (th * 60 + tm)
  if (diff <= 0) return ''
  const h = Math.floor(diff / 60)
  const m = diff % 60
  if (h === 0) return `+${m}min`
  if (m === 0) return `+${h}h`
  return `+${h}h${String(m).padStart(2, '0')}`
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function firstCheckin(user: UserDay): string | null {
  const ins = user.logs.filter((l) => l.type === 'in').sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  return ins.length > 0 ? ins[0].timestamp : null
}

function isLate(user: UserDay, threshold: string, _date: string): boolean {
  const ci = firstCheckin(user)
  if (!ci) return false
  const cairoMin = parseBackendTimestampToCairoMinutes(ci)
  if (cairoMin === null) return false
  const [th, tm] = threshold.split(':').map(Number)
  return cairoMin > th * 60 + tm
}

/** Retourne le statut enrichi pour un agent */
function enrichedStatus(user: UserDay, threshold: string, date: string): 'present' | 'present_late' | 'retard' | 'absent' | 'non_pointe' | 'conge' {
  if (user.status === 'absent') return 'absent'
  if (user.status === 'conge')  return 'conge'
  if (user.status === 'retard') return 'retard'
  if (isLate(user, threshold, date)) return 'present_late'
  if (user.last_action === 'in' || user.status === 'present') return 'present'
  return 'non_pointe'
}

const ManagerDash: React.FC = () => {
  const dispatch = useAppDispatch()
  const userDetail = useAppSelector((s) => s.user.userDetail)
  const lang = useLang()
  const STATUS_OPTIONS = getStatusOptions(lang)
  const JOURS = getJoursCourt(lang)
  const MOIS = getMois(lang)

  const myBureauId = userDetail?.bureau_id ?? (userDetail?.bureaux?.[0] as any)?.id ?? 0
  const username = userDetail?.username ?? ''
  const profil = (userDetail?.profil as string) ?? ''
  const profileLower = profil.toLowerCase()
  const isAdmin = profil === 'admin' || profil === 'superadmin'
  const canOpenCrmRecap = ['man', 'manager', 'crm_manager', 'crm manager', 'admin', 'superadmin'].includes(profileLower)
    && userDetail?.tenant !== 'tod'
  const managedBureauIds = Array.from(new Set((userDetail?.bureaux ?? [])
    .map((b: any) => Number(b?.id))
    .filter((id) => Number.isFinite(id) && id > 0)
  ))

  // Noms : JWT en priorité, fallback sur noms connus (pres : CRN/STV/etc, tod : du JWT)
  const bureauNameMap = buildBureauNameMap(userDetail?.bureaux)
  const getBureauLabel = (id: number) =>
    bureauNameMap[id] ? `${bureauNameMap[id]} (${id})` : `Bureau ${id}`
  const bureauOptions = managedBureauIds.length > 0
    ? managedBureauIds
    : (myBureauId ? [myBureauId] : [])
  const canSelectBureau = isAdmin || bureauOptions.length > 1

  const [selectedBureauId, setSelectedBureauId] = useState<number>(0)
  const bureauId = selectedBureauId || (bureauOptions[0] ?? 0)

  // Date sélectionnée (vue jour)
  const [selectedDate, setSelectedDate] = useState<string>(todayISO())
  const [data, setData] = useState<BureauDayResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Logs expandés
  const [expandedUser, setExpandedUser] = useState<number | null>(null)

  // Modal annotation
  const [editingUser, setEditingUser] = useState<UserDay | null>(null)
  const [editingDate, setEditingDate] = useState<string>('')
  const [noteDraft, setNoteDraft] = useState('')
  const [statusDraft, setStatusDraft] = useState<UiStatus>(null)
  const [saving, setSaving] = useState(false)

  // Modal renommage
  const [renamingUser, setRenamingUser] = useState<UserDay | null>(null)
  const [nomPresenceDraft, setNomPresenceDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(bureauId === 8 ? '10:00' : '10:30')

  const fetchDay = useCallback(async (date: string) => {
    if (!bureauId) return
    try {
      setLoading(true)
      setError(null)
      const res = await axios.post<BureauDayResponse>(`${API}/presence/by-bureau-day`, {
        bureau_id: bureauId,
        date_from: date,
        date_to: date,
      })
      setData(res.data)
    } catch (err: any) {
      setError(err?.response?.data?.message || (lang === 'en' ? 'Loading error' : 'Erreur lors du chargement'))
    } finally {
      setLoading(false)
    }
  }, [bureauId])

  useEffect(() => {
    fetchDay(selectedDate)
  }, [fetchDay, selectedDate])

  const goDay = (n: number) => {
    const next = addDays(selectedDate, n)
    if (next > todayISO()) return // pas dans le futur
    setSelectedDate(next)
    setExpandedUser(null)
  }

  const openEdit = (user: UserDay, date: string) => {
    setEditingUser(user)
    setEditingDate(date)
    setNoteDraft(user.note ?? '')
    setStatusDraft((user.status === 'partial' ? 'retard' : user.status) as UiStatus)
  }

  const closeEdit = () => {
    setEditingUser(null)
    setEditingDate('')
    setNoteDraft('')
    setStatusDraft(null)
  }

  const handleSave = async () => {
    if (!editingUser) return
    setSaving(true)
    try {
      const apiStatus: ApiStatus = statusDraft
      if (editingUser.daily_id) {
        await axios.patch(`${API}/presence/daily/${editingUser.daily_id}/note`, {
          note: noteDraft.trim() || null,
          status: apiStatus,
        })
      } else {
        await axios.post(`${API}/presence/daily`, {
          user_id: editingUser.user_id,
          username: editingUser.username,
          bureau_id: bureauId,
          profil: editingUser.profil ?? '',
          date: editingDate,
          status: apiStatus ?? 'absent',
          note: noteDraft.trim() || null,
        })
      }
      closeEdit()
      await fetchDay(selectedDate)
    } catch (err: any) {
      setError(err?.response?.data?.message || (lang === 'en' ? 'Save error' : 'Erreur lors de la sauvegarde'))
    } finally {
      setSaving(false)
    }
  }

  const openRename = (user: UserDay) => {
    setRenamingUser(user)
    setNomPresenceDraft(user.username)
    setRenameError(null)
  }

  const closeRename = () => {
    setRenamingUser(null)
    setNomPresenceDraft('')
    setRenameError(null)
  }

  const handleRename = async () => {
    if (!renamingUser || !nomPresenceDraft.trim()) return
    setRenaming(true)
    setRenameError(null)
    try {
      await axios.patch(`${API}/presence-user-map/by-user/${renamingUser.user_id}`, {
        nom_presence: nomPresenceDraft.trim(),
        bureau_id: bureauId,
      })
      closeRename()
      await fetchDay(selectedDate)
    } catch (err: any) {
      setRenameError(err?.response?.data?.message || (lang === 'en' ? 'Rename error' : 'Erreur lors du renommage'))
    } finally {
      setRenaming(false)
    }
  }

  const currentDay: DayEntry | null = data?.days?.[0] ?? null
  const users: UserDay[] = currentDay?.users ?? []

  const lateCount    = users.filter((u) => ['present_late', 'retard'].includes(enrichedStatus(u, threshold, selectedDate))).length
  const presentCount = users.filter((u) => ['present', 'present_late'].includes(enrichedStatus(u, threshold, selectedDate))).length
  const absentCount  = users.filter((u) => enrichedStatus(u, threshold, selectedDate) === 'absent').length
  const congeCount   = users.filter((u) => enrichedStatus(u, threshold, selectedDate) === 'conge').length
  const notChecked   = users.filter((u) => enrichedStatus(u, threshold, selectedDate) === 'non_pointe').length
  const isToday      = selectedDate === todayISO()

  return (
    <div className="presence-page">
      {/* Header */}
      <header className="presence-header">
        <div className="header-left">
          <span className="header-logo">📋</span>
          <span className="header-title">{lang === 'en' ? 'Attendance — Office' : 'Présences — Bureau'}</span>
        </div>
        <div className="header-right">
          <span className="header-user">
            <span className="header-username">{username}</span>
            {profil && <span className="header-badge">{profil}</span>}
          </span>
          {isAdmin ? (
            <>
              <Link to="/manager" className="btn-manager-link">{lang === 'en' ? '📊 Overview' : '📊 Général'}</Link>
              <span className="btn-manager-link btn-manager-link--active">{lang === 'en' ? '📅 Day View' : '📅 Journée'}</span>
              <Link to="/manager/agents" className="btn-manager-link">{lang === 'en' ? '👥 Agents' : '👥 Agents'}</Link>
              {canOpenCrmRecap && <Link to="/manager/crm-recap" className="btn-manager-link">{lang === 'en' ? '📈 CRM Recap' : '📈 CRM Récap'}</Link>}
            </>
          ) : (
            <>
              <Link to="/pointer" className="btn-manager-link">{lang === 'en' ? '⏱ Clock' : '⏱ Pointer'}</Link>
              <span className="btn-manager-link btn-manager-link--active">{lang === 'en' ? '📅 Day View' : '📅 Journée'}</span>
              <Link to="/manager/agents" className="btn-manager-link">{lang === 'en' ? '👥 Agents' : '👥 Agents'}</Link>
              {canOpenCrmRecap && <Link to="/manager/crm-recap" className="btn-manager-link">{lang === 'en' ? '📈 CRM Recap' : '📈 CRM Récap'}</Link>}
            </>
          )}
          <button className="btn-logout" onClick={() => dispatch(logout())}>{lang === 'en' ? 'Logout' : 'Déconnexion'}</button>
        </div>
      </header>

      <div className="manager-layout">

        {/* Navigation date */}
        <div className="manager-top">
          <div className="date-nav">
            <button className="date-nav-btn" onClick={() => goDay(-1)}>‹</button>
            <div className="date-nav-center">
              <span className="date-nav-label">{formatDateFR(selectedDate, JOURS, MOIS)}</span>
              {!isToday && (
                <button className="date-nav-today" onClick={() => setSelectedDate(todayISO())}>
                  {lang === 'en' ? 'Today' : "Aujourd'hui"}
                </button>
              )}
            </div>
            <button className="date-nav-btn" onClick={() => goDay(1)} disabled={isToday}>›</button>
          </div>

          <div className="manager-top-right">
            {canSelectBureau && (
              <div className="bureau-select-control">
                <label htmlFor="bureau-select-dash">{lang === 'en' ? '🏢 Office' : '🏢 Bureau'}</label>
                <select
                  id="bureau-select-dash"
                  className="bureau-select"
                  value={selectedBureauId || (bureauOptions[0] ?? 0)}
                  onChange={(e) => setSelectedBureauId(Number(e.target.value))}
                >
                  {bureauOptions.map((id) => (
                    <option key={id} value={id}>{getBureauLabel(id)}</option>
                  ))}
                </select>
              </div>
            )}
            <input
              type="date"
              className="date-picker"
              value={selectedDate}
              max={todayISO()}
              onChange={(e) => { if (e.target.value) setSelectedDate(e.target.value) }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: '#94a3b8' }}>
              ⏰
              <input
                type="time"
                className="date-picker"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </label>
            <button className="btn-refresh" onClick={() => fetchDay(selectedDate)} disabled={loading}>
              {loading ? '...' : '↻'}
            </button>
          </div>
        </div>

        {/* Compteurs */}
        <div className="manager-counters">
          <div className="counter-card counter-present">
            <span className="counter-num">{presentCount}<span className="counter-num-total">/{users.length}</span></span>
            <span className="counter-label">{lang === 'en' ? 'On service' : 'En service'}</span>
          </div>
          <div className="counter-card counter-late">
            <span className="counter-num">{lateCount}</span>
            <span className="counter-label">{lang === 'en' ? 'Late' : 'En retard'}</span>
          </div>
          <div className="counter-card counter-absent">
            <span className="counter-num">
              {absentCount}
              <span className="counter-num-secondary"> / {congeCount}</span>
            </span>
            <span className="counter-label">{lang === 'en' ? 'Absent / Leave' : 'Absents / Congés'}</span>
          </div>
          <div className="counter-card counter-waiting">
            <span className="counter-num">{notChecked}</span>
            <span className="counter-label">{lang === 'en' ? 'Not clocked' : 'Non pointés'}</span>
          </div>
        </div>

        {error && <div className="alert-error">{error}</div>}

        {/* Colonnes par statut */}
        {loading ? (
          <div className="loading-state">{lang === 'en' ? 'Loading...' : 'Chargement...'}</div>
        ) : users.length === 0 ? (
          <div className="agents-empty">{lang === 'en' ? 'No agents for this office today' : 'Aucun agent pour ce bureau ce jour'}</div>
        ) : (
          <div className="status-columns">

            {/* En service (présent + présent/retard) */}
            <div className="status-col">
              <div className="status-col-header status-col-header--present">
                <span>{lang === 'en' ? '● On service' : '● En service'}</span>
                <span className="status-col-count">{presentCount}/{users.length}</span>
              </div>
              <div className="status-col-body">
                {users.filter((u) => ['present','present_late'].includes(enrichedStatus(u, threshold, selectedDate))).map((user) => {
                  const es = enrichedStatus(user, threshold, selectedDate)
                  return (
                    <div key={user.user_id} className="status-col-agent" onClick={() => openEdit(user, selectedDate)} style={{ cursor: 'pointer' }}>
                      <div className="status-col-agent-info">
                        <span className="agent-name">{user.username}</span>
                        {user.profil && <span className="agent-profil">{profilLabel(user.profil)}</span>}
                        {es === 'present_late' && (
                          <span style={{ fontSize: '0.7rem', color: '#4ade80', opacity: 0.8 }}>⏰</span>
                        )}
                        {user.note && <span className="status-col-note">{user.note}</span>}
                      </div>
                    </div>
                  )
                })}
                {users.filter((u) => ['present','present_late'].includes(enrichedStatus(u, threshold, selectedDate))).length === 0 && (
                  <div className="status-col-empty">—</div>
                )}
              </div>
            </div>

            {/* En retard (sorti en retard uniquement) */}
            <div className="status-col">
              <div className="status-col-header status-col-header--late">
                <span>{lang === 'en' ? '⏰ Late' : '⏰ En retard'}</span>
                <span className="status-col-count">{lateCount}</span>
              </div>
              <div className="status-col-body">
                {users.filter((u) => ['present_late', 'retard'].includes(enrichedStatus(u, threshold, selectedDate))).map((user) => (
                  <div key={user.user_id} className="status-col-agent" onClick={() => openEdit(user, selectedDate)} style={{ cursor: 'pointer' }}>
                    <div className="status-col-agent-info">
                      <span className="agent-name">{user.username}</span>
                      {user.profil && <span className="agent-profil">{profilLabel(user.profil)}</span>}
                      {(() => {
                        const ci = firstCheckin(user)
                        if (!ci) return null
                        const t = formatTime(ci, bureauId)
                        const delay = formatDelay(t, threshold)
                        return (
                          <>
                            <span className="status-col-time">▶ {t}</span>
                            {delay && <span className="status-col-delay">{delay}</span>}
                          </>
                        )
                      })()}
                      {user.note && <span className="status-col-note">{user.note}</span>}
                    </div>
                  </div>
                ))}
                {lateCount === 0 && <div className="status-col-empty">—</div>}
              </div>
            </div>

            {/* Absents / Congés */}
            <div className="status-col">
              <div className="status-col-header status-col-header--absent">
                <span>{lang === 'en' ? '✗ Absent / Leave' : '✗ Absents / Congés'}</span>
                <span className="status-col-count">{absentCount} / {congeCount}</span>
              </div>
              <div className="status-col-body">
                {users.filter((u) => ['absent','conge'].includes(enrichedStatus(u, threshold, selectedDate))).map((user) => {
                  const es = enrichedStatus(user, threshold, selectedDate)
                  return (
                    <div key={user.user_id} className="status-col-agent" onClick={() => openEdit(user, selectedDate)} style={{ cursor: 'pointer' }}>
                      <div className="status-col-agent-info">
                        <span className="agent-name">{user.username}</span>
                        {user.profil && <span className="agent-profil">{profilLabel(user.profil)}</span>}
                        <span className="alerts-status-badge" style={{ fontSize: '0.7rem', padding: '1px 6px', background: es === 'conge' ? '#818cf822' : '#ef444422', color: es === 'conge' ? '#818cf8' : '#ef4444', borderColor: es === 'conge' ? '#818cf855' : '#ef444455' }}>
                          {es === 'conge' ? (lang === 'en' ? 'Leave' : 'Congé') : 'Absent'}
                        </span>
                        {user.note && <span className="status-col-note">{user.note}</span>}
                      </div>
                    </div>
                  )
                })}
                {absentCount + congeCount === 0 && <div className="status-col-empty">—</div>}
              </div>
            </div>

            {/* Non pointés */}
            <div className="status-col">
              <div className="status-col-header status-col-header--np">
                <span>{lang === 'en' ? '○ Not clocked' : '○ Non pointés'}</span>
                <span className="status-col-count">{notChecked}</span>
              </div>
              <div className="status-col-body">
                {users.filter((u) => enrichedStatus(u, threshold, selectedDate) === 'non_pointe').map((user) => (
                  <div key={user.user_id} className="status-col-agent" onClick={() => openEdit(user, selectedDate)} style={{ cursor: 'pointer' }}>
                    <div className="status-col-agent-info">
                      <span className="agent-name">{user.username}</span>
                      {user.profil && <span className="agent-profil">{profilLabel(user.profil)}</span>}
                      {user.note && <span className="status-col-note">{user.note}</span>}
                    </div>
                  </div>
                ))}
                {notChecked === 0 && <div className="status-col-empty">—</div>}
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Modal annotation */}
      {editingUser && (
        <div className="modal-overlay" onClick={closeEdit}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{lang === 'en' ? 'Annotate — ' : 'Annoter — '}<span className="modal-agent-name">{editingUser.username}</span>
                <span className="modal-date-sub">{formatDateFR(editingDate, JOURS, MOIS)}</span>
              </h3>
              <button className="modal-close" onClick={closeEdit}>✕</button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>{lang === 'en' ? 'Day status' : 'Statut du jour'}</label>
                <div className="status-pills">
                  {STATUS_OPTIONS.map((s) => (
                    <button
                      key={s.value as string}
                      className={`status-pill ${statusDraft === s.value ? 'status-pill--active' : ''}`}
                      style={{ '--pill-color': s.color } as React.CSSProperties}
                      onClick={() => setStatusDraft(s.value)}
                      type="button"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="manager-note">{lang === 'en' ? 'Note for this day' : 'Note sur cette journée'}</label>
                <textarea
                  id="manager-note"
                  className="log-note-input"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder={lang === 'en' ? 'E.g. absent for medical reasons, justified late...' : 'Ex : absent pour raison médicale, retard justifié...'}
                  rows={4}
                  maxLength={1000}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-save-note" onClick={handleSave} disabled={saving}>
                {saving ? (lang === 'en' ? 'Saving...' : 'Sauvegarde...') : (lang === 'en' ? 'Save' : 'Sauvegarder')}
              </button>
              <button className="btn-cancel-note" onClick={closeEdit}>{lang === 'en' ? 'Cancel' : 'Annuler'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default ManagerDash