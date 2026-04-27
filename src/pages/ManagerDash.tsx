import React, { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { logout } from '../features/auth/authSlice'

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
  ret:   'R',
  sup:   'S',
  man:   'M',
  cm:    'CM',
  agent: 'A',
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
  status: 'present' | 'absent' | 'partial' | 'conge' | null
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

const STATUS_OPTIONS: { value: UserDay['status']; label: string; color: string }[] = [
  { value: 'present', label: 'Présent',  color: '#22c55e' },
  { value: 'absent',  label: 'Absent',   color: '#ef4444' },
  { value: 'partial', label: 'Partiel',  color: '#f59e0b' },
  { value: 'conge',   label: 'Congé',    color: '#818cf8' },
]

// ── Utils ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDateFR(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// ── Component ──────────────────────────────────────────────────────────────

const ManagerDash: React.FC = () => {
  const dispatch = useAppDispatch()
  const userDetail = useAppSelector((s) => s.user.userDetail)

  const myBureauId = userDetail?.bureau_id ?? (userDetail?.bureaux?.[0] as any)?.id ?? 0
  const username = userDetail?.username ?? ''
  const profil = (userDetail?.profil as string) ?? ''
  const isAdmin = profil === 'admin' || profil === 'superadmin'

  const BUREAU_IDS = [4, 5, 6, 7, 8, 9, 10]

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
  const [statusDraft, setStatusDraft] = useState<UserDay['status']>(null)
  const [saving, setSaving] = useState(false)

  // Modal renommage
  const [renamingUser, setRenamingUser] = useState<UserDay | null>(null)
  const [nomPresenceDraft, setNomPresenceDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

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
    setStatusDraft(user.status ?? null)
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
      if (editingUser.daily_id) {
        await axios.patch(`${API}/presence/daily/${editingUser.daily_id}/note`, {
          note: noteDraft.trim() || null,
          status: statusDraft,
        })
      } else {
        await axios.post(`${API}/presence/daily`, {
          user_id: editingUser.user_id,
          username: editingUser.username,
          bureau_id: bureauId,
          profil: editingUser.profil ?? '',
          date: editingDate,
          status: statusDraft ?? 'absent',
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

  const presentCount = users.filter((u) => u.last_action === 'in').length
  const absentCount  = users.filter((u) => u.status === 'absent').length
  const notChecked   = users.filter((u) => !u.last_action && u.status !== 'absent' && u.status !== 'conge').length
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
          <Link to="/" className="btn-manager-link">⏱ Mon pointage</Link>
          <Link to="/manager" className="btn-manager-link">📅 Bureau</Link>
          <Link to="/manager/agents" className="btn-manager-link">👥 Agents</Link>
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
            {isAdmin && (
              <div className="bureau-select-control">
                <label htmlFor="bureau-select-dash">🏢 Bureau</label>
                <select
                  id="bureau-select-dash"
                  className="bureau-select"
                  value={selectedBureauId || myBureauId}
                  onChange={(e) => setSelectedBureauId(Number(e.target.value))}
                >
                  {BUREAU_IDS.map((id) => (
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
            <button className="btn-refresh" onClick={() => fetchDay(selectedDate)} disabled={loading}>
              {loading ? '...' : '↻'}
            </button>
          </div>
        </div>

        {/* Compteurs */}
        <div className="manager-counters">
          <div className="counter-card counter-present">
            <span className="counter-num">{presentCount}</span>
            <span className="counter-label">En service</span>
          </div>
          <div className="counter-card counter-absent">
            <span className="counter-num">{absentCount}</span>
            <span className="counter-label">Absents</span>
          </div>
          <div className="counter-card counter-waiting">
            <span className="counter-num">{notChecked}</span>
            <span className="counter-label">Non pointés</span>
          </div>
          <div className="counter-card counter-total">
            <span className="counter-num">{users.length}</span>
            <span className="counter-label">Total agents</span>
          </div>
        </div>

        {error && <div className="alert-error">{error}</div>}

        {/* Liste agents */}
        {loading ? (
          <div className="loading-state">Chargement...</div>
        ) : (
          <div className="agents-table">
            <div className="agents-table-header">
              <span>Agent</span>
              <span>Statut</span>
              <span>Pointage</span>
              <span>Note manager</span>
              <span></span>
            </div>

            {users.length === 0 ? (
              <div className="agents-empty">Aucun agent pour ce bureau ce jour</div>
            ) : (
              users.map((user) => (
                <React.Fragment key={user.user_id}>
                  <div className="agent-row">
                    {/* Nom */}
                    <div className="agent-info">
                      <span className="agent-name">{user.username}</span>
                      {user.profil && <span className="agent-profil">{profilLabel(user.profil)}</span>}
                    </div>

                    {/* Statut daily */}
                    <div>
                      {user.status ? (
                        <span className={`agent-status-badge as-${user.status}`}>
                          {STATUS_OPTIONS.find((s) => s.value === user.status)?.label}
                        </span>
                      ) : (
                        <span className="agent-status-badge as-none">—</span>
                      )}
                    </div>

                    {/* Dernier pointage */}
                    <div className="agent-action-col">
                      {user.last_action === 'in' ? (
                        <span className="action-badge action-in">● EN SERVICE</span>
                      ) : user.last_action === 'out' ? (
                        <span className="action-badge action-out">■ SORTI</span>
                      ) : (
                        <span className="action-badge action-none">Pas pointé</span>
                      )}
                      {user.logs.length > 0 && (
                        <button
                          className="btn-show-logs"
                          onClick={() => setExpandedUser(expandedUser === user.user_id ? null : user.user_id)}
                        >
                          {user.logs.length} pointage{user.logs.length > 1 ? 's' : ''} {expandedUser === user.user_id ? '▲' : '▼'}
                        </button>
                      )}
                    </div>

                    {/* Note manager */}
                    <div className="agent-note-preview">
                      {user.note
                        ? <span className="note-preview-text" title={user.note}>{user.note}</span>
                        : <span className="note-preview-empty">—</span>
                      }
                    </div>

                    {/* Actions */}
                    <div className="agent-actions-col">
                      <button className="btn-agent-edit" onClick={() => openEdit(user, selectedDate)}>
                        ✏️ Annoter
                      </button>
                      <button className="btn-agent-rename" onClick={() => openRename(user)}>
                        🏷️ Renommer
                      </button>
                    </div>
                  </div>

                  {/* Logs détaillés */}
                  {expandedUser === user.user_id && user.logs.length > 0 && (
                    <div className="agent-logs-expanded">
                      {user.logs.map((log) => (
                        <div key={log.id} className={`log-mini log-mini-${log.type}`}>
                          <span className={`log-type-badge log-type-${log.type}`}>
                            {log.type === 'in' ? '▶ ARRIVÉE' : '■ DÉPART'}
                          </span>
                          <span className="log-time">{formatTime(log.timestamp)}</span>
                          {log.note && <span className="log-mini-note">{log.note}</span>}
                          {log.ip_address && <span className="log-ip">{log.ip_address}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              ))
            )}
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
      {/* Modal renommage */}
      {renamingUser && (
        <div className="modal-overlay" onClick={closeRename}>
          <div className="modal-box modal-box--sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Renommer — <span className="modal-agent-name">{renamingUser.username}</span></h3>
              <button className="modal-close" onClick={closeRename}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="nom-presence">Nom de présence</label>
                <input
                  id="nom-presence"
                  type="text"
                  className="rename-input"
                  value={nomPresenceDraft}
                  onChange={(e) => setNomPresenceDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                  placeholder="ex: jean.dupont"
                  maxLength={100}
                  autoFocus
                />
              </div>
              {renameError && <div className="alert-error" style={{ marginTop: '8px' }}>{renameError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn-save-note" onClick={handleRename} disabled={renaming || !nomPresenceDraft.trim()}>
                {renaming ? 'Sauvegarde...' : 'Confirmer'}
              </button>
              <button className="btn-cancel-note" onClick={closeRename}>Annuler</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ManagerDash