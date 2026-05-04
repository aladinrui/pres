import React, { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { logout } from '../features/auth/authSlice'
import {
  convertUtcHHMMToBusinessHHMM,
  formatIsoTimeInBusinessTZ,
  toBusinessISODate,
} from '../utils/businessTime'

const API = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000') + '/api'

const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const JOURS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

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

const STATUS_OPTIONS: { value: UiStatus; label: string; color: string }[] = [
  { value: 'absent',  label: 'Absent',   color: '#ef4444' },
  { value: 'retard',  label: 'Retard',   color: '#fb923c' },
  { value: 'conge',   label: 'Congé',    color: '#818cf8' },
]

// ── Utils ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  return toBusinessISODate()
}

function formatDateFR(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`
}

function formatTime(iso: string): string {
  return formatIsoTimeInBusinessTZ(iso)
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
  const hhmm = convertUtcHHMMToBusinessHHMM(ci.slice(11, 16))
  return hhmm > threshold
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

  const myBureauId = userDetail?.bureau_id ?? (userDetail?.bureaux?.[0] as any)?.id ?? 0
  const username = userDetail?.username ?? ''
  const profil = (userDetail?.profil as string) ?? ''
  const profileLower = profil.toLowerCase()
  const isAdmin = profil === 'admin' || profil === 'superadmin'
  const canOpenCrmRecap = ['crm_manager', 'crm manager', 'admin', 'superadmin'].includes(profileLower)
  const managedBureauIds = Array.from(new Set((userDetail?.bureaux ?? [])
    .map((b: any) => Number(b?.id))
    .filter((id) => Number.isFinite(id) && id > 0)
  ))

  const BUREAU_IDS = [3, 4, 5, 6, 7, 8, 9, 10]
  const bureauOptions = isAdmin
    ? BUREAU_IDS
    : (managedBureauIds.length > 0 ? managedBureauIds : (myBureauId ? [myBureauId] : []))
  const canSelectBureau = isAdmin || bureauOptions.length > 1

  const [selectedBureauId, setSelectedBureauId] = useState<number>(0)
  const bureauId = selectedBureauId || myBureauId

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
  const [threshold, setThreshold] = useState('10:30')

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
      setError(err?.response?.data?.message || 'Erreur lors du chargement')
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
      setError(err?.response?.data?.message || 'Erreur lors de la sauvegarde')
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
      setRenameError(err?.response?.data?.message || 'Erreur lors du renommage')
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
          <span className="header-title">Présences — Bureau</span>
        </div>
        <div className="header-right">
          <span className="header-user">
            <span className="header-username">{username}</span>
            {profil && <span className="header-badge">{profil}</span>}
          </span>
          {isAdmin ? (
            <>
              <Link to="/manager" className="btn-manager-link">📊 Général</Link>
              <span className="btn-manager-link btn-manager-link--active">📅 Journée</span>
              <Link to="/manager/agents" className="btn-manager-link">👥 Agents</Link>
              {canOpenCrmRecap && <Link to="/manager/crm-recap" className="btn-manager-link">📈 CRM Récap</Link>}
            </>
          ) : (
            <>
              <Link to="/pointer" className="btn-manager-link">⏱ Pointer</Link>
              <span className="btn-manager-link btn-manager-link--active">📅 Journée</span>
              <Link to="/manager/agents" className="btn-manager-link">👥 Agents</Link>
              {canOpenCrmRecap && <Link to="/manager/crm-recap" className="btn-manager-link">📈 CRM Récap</Link>}
            </>
          )}
          <button className="btn-logout" onClick={() => dispatch(logout())}>Déconnexion</button>
        </div>
      </header>

      <div className="manager-layout">

        {/* Navigation date */}
        <div className="manager-top">
          <div className="date-nav">
            <button className="date-nav-btn" onClick={() => goDay(-1)}>‹</button>
            <div className="date-nav-center">
              <span className="date-nav-label">{formatDateFR(selectedDate)}</span>
              {!isToday && (
                <button className="date-nav-today" onClick={() => setSelectedDate(todayISO())}>
                  Aujourd'hui
                </button>
              )}
            </div>
            <button className="date-nav-btn" onClick={() => goDay(1)} disabled={isToday}>›</button>
          </div>

          <div className="manager-top-right">
            {canSelectBureau && (
              <div className="bureau-select-control">
                <label htmlFor="bureau-select-dash">🏢 Bureau</label>
                <select
                  id="bureau-select-dash"
                  className="bureau-select"
                  value={selectedBureauId || myBureauId}
                  onChange={(e) => setSelectedBureauId(Number(e.target.value))}
                >
                  {bureauOptions.map((id) => (
                    <option key={id} value={id}>{bureauLabel(id)}</option>
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
            <span className="counter-label">En service</span>
          </div>
          <div className="counter-card counter-late">
            <span className="counter-num">{lateCount}</span>
            <span className="counter-label">En retard</span>
          </div>
          <div className="counter-card counter-absent">
            <span className="counter-num">
              {absentCount}
              <span className="counter-num-secondary"> / {congeCount}</span>
            </span>
            <span className="counter-label">Absents / Congés</span>
          </div>
          <div className="counter-card counter-waiting">
            <span className="counter-num">{notChecked}</span>
            <span className="counter-label">Non pointés</span>
          </div>
        </div>

        {error && <div className="alert-error">{error}</div>}

        {/* Colonnes par statut */}
        {loading ? (
          <div className="loading-state">Chargement...</div>
        ) : users.length === 0 ? (
          <div className="agents-empty">Aucun agent pour ce bureau ce jour</div>
        ) : (
          <div className="status-columns">

            {/* En service (présent + présent/retard) */}
            <div className="status-col">
              <div className="status-col-header status-col-header--present">
                <span>● En service</span>
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
                <span>⏰ En retard</span>
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
                        const t = formatTime(ci)
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
                <span>✗ Absents / Congés</span>
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
                          {es === 'conge' ? 'Congé' : 'Absent'}
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
                <span>○ Non pointés</span>
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
              <h3>Annoter — <span className="modal-agent-name">{editingUser.username}</span>
                <span className="modal-date-sub">{formatDateFR(editingDate)}</span>
              </h3>
              <button className="modal-close" onClick={closeEdit}>✕</button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Statut du jour</label>
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
                <label htmlFor="manager-note">Note sur cette journée</label>
                <textarea
                  id="manager-note"
                  className="log-note-input"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Ex : absent pour raison médicale, retard justifié..."
                  rows={4}
                  maxLength={1000}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-save-note" onClick={handleSave} disabled={saving}>
                {saving ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
              <button className="btn-cancel-note" onClick={closeEdit}>Annuler</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default ManagerDash