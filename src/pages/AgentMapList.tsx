import React, { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { logout } from '../features/auth/authSlice'

const API = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000') + '/api'

// ── Mapping bureaux ────────────────────────────────────────────────────────

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
const BUREAU_IDS = [3, 4, 5, 6, 7, 8, 9, 10]
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

type AgentMap = {
  id: number
  user_id: number
  username: string
  nom_presence: string | null
  bureau_id: number
  profil: string | null
  is_active: 0 | 1
}

// ── Component ──────────────────────────────────────────────────────────────

const AgentMapList: React.FC = () => {
  const dispatch = useAppDispatch()
  const userDetail = useAppSelector((s) => s.user.userDetail)

  const myBureauId = userDetail?.bureau_id ?? (userDetail?.bureaux?.[0] as any)?.id ?? 0
  const username = userDetail?.username ?? ''
  const profil = (userDetail?.profil as string) ?? ''
  const isAdmin = profil === 'admin' || profil === 'superadmin'

  const [agents, setAgents] = useState<AgentMap[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Bureau sélectionné (admin peut choisir, manager voit le sien)
  const [selectedBureauId, setSelectedBureauId] = useState<number>(0)
  const activeBureauId = selectedBureauId || myBureauId

  // Filtre tous les bureaux (admin only)
  const [showAllBureaux, setShowAllBureaux] = useState<boolean>(false)

  // Filtre actif/inactif
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('active')

  // Recherche
  const [search, setSearch] = useState('')

  // Toggle is_active en cours
  const [togglingId, setTogglingId] = useState<number | null>(null)

  // Changement profil en cours
  const [changingProfilId, setChangingProfilId] = useState<number | null>(null)

  // Modal renommage
  const [renamingAgent, setRenamingAgent] = useState<AgentMap | null>(null)
  const [nomDraft, setNomDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)

  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const url = (isAdmin && showAllBureaux)
        ? `${API}/presence-user-map`
        : `${API}/presence-user-map?bureau_id=${activeBureauId}`
      const res = await axios.get<AgentMap[]>(url)
      setAgents(res.data)
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erreur lors du chargement')
    } finally {
      setLoading(false)
    }
  }, [activeBureauId, isAdmin, showAllBureaux])

  useEffect(() => {
    fetchAgents()
  }, [fetchAgents])

  const openRename = (agent: AgentMap) => {
    setRenamingAgent(agent)
    setNomDraft(agent.nom_presence ?? agent.username)
    setRenameError(null)
  }

  const closeRename = () => {
    setRenamingAgent(null)
    setNomDraft('')
    setRenameError(null)
  }

  const handleRename = async () => {
    if (!renamingAgent || !nomDraft.trim()) return
    setRenaming(true)
    setRenameError(null)
    try {
      await axios.patch(`${API}/presence-user-map/by-user/${renamingAgent.user_id}`, {
        nom_presence: nomDraft.trim(),
      })
      closeRename()
      await fetchAgents()
    } catch (err: any) {
      setRenameError(err?.response?.data?.message || 'Erreur lors du renommage')
    } finally {
      setRenaming(false)
    }
  }

  const handleToggleActive = async (agent: AgentMap) => {
    setTogglingId(agent.user_id)
    try {
      await axios.patch(`${API}/presence-user-map/by-user/${agent.user_id}`, {
        is_active: agent.is_active === 1 ? 0 : 1,
      })
      await fetchAgents()
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erreur lors de la mise à jour')
    } finally {
      setTogglingId(null)
    }
  }

  const handleChangeProfil = async (agent: AgentMap, newProfil: string) => {
    setChangingProfilId(agent.user_id)
    try {
      await axios.patch(`${API}/presence-user-map/by-user/${agent.user_id}`, {
        profil: newProfil || null,
      })
      await fetchAgents()
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Erreur lors du changement de profil')
    } finally {
      setChangingProfilId(null)
    }
  }

  const filtered = agents.filter((a) => {
    if (filterActive === 'active'   && a.is_active !== 1) return false
    if (filterActive === 'inactive' && a.is_active !== 0) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      a.username.toLowerCase().includes(q) ||
      (a.nom_presence ?? '').toLowerCase().includes(q) ||
      (a.profil ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="presence-page">
      {/* Header */}
      <header className="presence-header">
        <div className="header-left">
          <span className="header-logo">👥</span>
          <span className="header-title">Agents — Mapping présence</span>
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
              <span className="btn-manager-link btn-manager-link--active">👥 Agents</span>
            </>
          ) : (
            <>
              <Link to="/" className="btn-manager-link">⏱ Pointer</Link>
              <Link to="/manager/day" className="btn-manager-link">📅 Journée</Link>
              <span className="btn-manager-link btn-manager-link--active">👥 Agents</span>
            </>
          )}
          <button className="btn-logout" onClick={() => dispatch(logout())}>Déconnexion</button>
        </div>
      </header>

      <div className="manager-layout">

        {/* Barre d'outils — style overview-toolbar */}
        <div className="overview-toolbar">

          {/* Sélecteur bureau admin */}
          {isAdmin && (
            <div className="bureau-select-control">
              <label htmlFor="bureau-select-agents">🏢 Bureau</label>
              <select
                id="bureau-select-agents"
                className="bureau-select"
                value={showAllBureaux ? 'all' : activeBureauId}
                onChange={(e) => {
                  if (e.target.value === 'all') {
                    setShowAllBureaux(true)
                    setSelectedBureauId(0)
                  } else {
                    setShowAllBureaux(false)
                    setSelectedBureauId(Number(e.target.value))
                  }
                }}
              >
                <option value="all">Tous les bureaux</option>
                {BUREAU_IDS.map((id) => (
                  <option key={id} value={id}>{bureauLabel(id)}</option>
                ))}
              </select>
            </div>
          )}

          {/* Filtre actif/inactif */}
          <div className="filter-group">
            {(['all', 'active', 'inactive'] as const).map((v) => (
              <button
                key={v}
                className={`filter-btn${filterActive === v ? ' filter-btn--active' : ''}`}
                onClick={() => setFilterActive(v)}
              >
                {v === 'all' ? 'Tous' : v === 'active' ? '✅ Actifs' : '🚫 Inactifs'}
              </button>
            ))}
          </div>

          {/* Recherche */}
          <input
            type="text"
            className="overview-search"
            placeholder="🔍 Rechercher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <button className="btn-refresh" onClick={fetchAgents} disabled={loading}>
            {loading ? '...' : '↻'}
          </button>
        </div>

        {error && <div className="alert-error">{error}</div>}

        {/* Compteur */}
        <div className="agent-map-count">
          {loading ? '...' : `${filtered.length} agent${filtered.length > 1 ? 's' : ''}`}
        </div>

        {/* Table */}
        {loading ? (
          <div className="loading-state">Chargement...</div>
        ) : (
          <div className="agents-table">
            <div className="agents-table-header agents-table-header--map">
              <span>Utilisateur</span>
              <span>Nom présence</span>
              <span>Bureau</span>
              <span>Profil</span>
              <span>Statut</span>
              <span></span>
            </div>

            {filtered.length === 0 ? (
              <div className="agents-empty">Aucun agent trouvé</div>
            ) : (
              filtered.map((agent) => (
                <div key={agent.id} className="agent-row agent-row--map">
                  <div className="agent-info">
                    <span className="agent-name">{agent.username}</span>
                    <span className="agent-id-sub">ID {agent.user_id}</span>
                  </div>

                  <div>
                    {agent.nom_presence ? (
                      <span className="nom-presence-value">{agent.nom_presence}</span>
                    ) : (
                      <span className="note-preview-empty">—</span>
                    )}
                  </div>

                  <div>
                    <span className="bureau-name-badge">
                      {BUREAU_NAMES[agent.bureau_id] ?? `#${agent.bureau_id}`}
                    </span>
                  </div>

                  <div className="profil-cell">
                    <select
                      className={`profil-select profil-select--${agent.profil ?? 'none'}`}
                      value={agent.profil ?? ''}
                      disabled={changingProfilId === agent.user_id}
                      onChange={(e) => handleChangeProfil(agent, e.target.value)}
                    >
                      <option value="">—</option>
                      <option value="ret">R</option>
                      <option value="sup">S</option>
                      <option value="man">M</option>
                      <option value="cm">CM</option>
                    </select>
                    {changingProfilId === agent.user_id && <span className="profil-saving">⋯</span>}
                  </div>

                  <div>
                    <span
                      className={`agent-active-badge ${agent.is_active === 1 ? 'agent-active-badge--on' : 'agent-active-badge--off'}`}
                    >
                      {agent.is_active === 1 ? '✅ Actif' : '🚫 Inactif'}
                    </span>
                  </div>

                  <div className="agent-actions-col">
                    <button className="btn-agent-rename" onClick={() => openRename(agent)}>
                      🏷️ Renommer
                    </button>
                    <button
                      className={`btn-agent-toggle ${agent.is_active === 1 ? 'btn-agent-toggle--off' : 'btn-agent-toggle--on'}`}
                      onClick={() => handleToggleActive(agent)}
                      disabled={togglingId === agent.user_id}
                    >
                      {togglingId === agent.user_id
                        ? '...'
                        : agent.is_active === 1 ? 'Désactiver' : 'Activer'
                      }
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Modal renommage */}
      {renamingAgent && (
        <div className="modal-overlay" onClick={closeRename}>
          <div className="modal-box modal-box--sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Renommer — <span className="modal-agent-name">{renamingAgent.username}</span></h3>
              <button className="modal-close" onClick={closeRename}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="nom-presence">Nom de présence</label>
                <input
                  id="nom-presence"
                  type="text"
                  className="rename-input"
                  value={nomDraft}
                  onChange={(e) => setNomDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                  placeholder="ex: jean.dupont"
                  maxLength={100}
                  autoFocus
                />
              </div>
              {renameError && <div className="alert-error" style={{ marginTop: '8px' }}>{renameError}</div>}
            </div>
            <div className="modal-footer">
              <button
                className="btn-save-note"
                onClick={handleRename}
                disabled={renaming || !nomDraft.trim()}
              >
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

export default AgentMapList
