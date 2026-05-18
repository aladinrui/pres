import React, { useEffect, useState, useCallback } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { logout } from '../features/auth/authSlice'
import { buildBureauNameMap } from '../utils/bureaux'
import { useLang } from '../utils/i18n'

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
  const lang = useLang()

  const myBureauId = userDetail?.bureau_id ?? (userDetail?.bureaux?.[0] as any)?.id ?? 0
  const username = userDetail?.username ?? ''
  const profil = (userDetail?.profil as string) ?? ''
  const isAdmin = profil === 'admin' || profil === 'superadmin'
  const profileLower = profil.toLowerCase()
  const canOpenCrmRecap = ['crm_manager', 'crm manager', 'admin', 'superadmin'].includes(profileLower)
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

  const [agents, setAgents] = useState<AgentMap[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Bureau sélectionné (admin peut choisir, manager voit le sien)
  // Pour l'admin, le défaut est le premier bureau de la liste (BUREAU_IDS[0]) et non myBureauId
  // qui peut être un ID hors système de présence (ex: 101)
  const [selectedBureauId, setSelectedBureauId] = useState<number>(0)
  const activeBureauId = selectedBureauId || (bureauOptions[0] ?? 0)

  // Filtre tous les bureaux (admin only)
  const [showAllBureaux, setShowAllBureaux] = useState<boolean>(false)

  // Filtre actif/inactif
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('active')

  // Recherche
  const [search, setSearch] = useState('')

  // Tenant du user connecté
  const isTodTenant = (userDetail?.tenant as string | null | undefined) === 'tod'

  // Modal créer agent (tod only)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [createForm, setCreateForm] = useState({
    username: '',
    password: '',
    profil: 'agent',
    bureauxIds: [] as number[],
    nom_presence: '',
  })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const openCreateAgent = () => {
    setCreateForm({
      username: '',
      password: '',
      profil: 'agent',
      bureauxIds: activeBureauId ? [activeBureauId] : [],
      nom_presence: '',
    })
    setCreateError(null)
    setShowCreateAgent(true)
  }

  const closeCreateAgent = () => {
    setShowCreateAgent(false)
    setCreateError(null)
  }

  const handleCreateAgent = async () => {
    // Defense in depth : ne jamais appeler l'API si le tenant n'est pas tod
    if (!isTodTenant) {
      setCreateError(lang === 'en' ? 'Action not authorized for this tenant.' : 'Action non autorisée pour ce tenant.')
      return
    }
    if (!createForm.username.trim() || !createForm.password.trim()) {
      setCreateError(lang === 'en' ? 'Username and password are required.' : 'Username et mot de passe sont obligatoires.')
      return
    }
    if (createForm.bureauxIds.length === 0) {
      setCreateError(lang === 'en' ? 'Select at least one office.' : 'Sélectionne au moins un bureau.')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const body: Record<string, any> = {
        username: createForm.username.trim(),
        password: createForm.password.trim(),
        profil: createForm.profil,
        is_active: true,
        bureauxIds: createForm.bureauxIds,
      }
      if (createForm.nom_presence.trim()) body.nom_presence = createForm.nom_presence.trim()
      await axios.post(`${API}/users/createUser`, body)
      closeCreateAgent()
      await fetchAgents()
    } catch (err: any) {
      setCreateError(err?.response?.data?.message || (lang === 'en' ? 'Error creating agent.' : 'Erreur lors de la création.'))
    } finally {
      setCreating(false)
    }
  }

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
      setError(err?.response?.data?.message || (lang === 'en' ? 'Loading error' : 'Erreur lors du chargement'))
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
      setRenameError(err?.response?.data?.message || (lang === 'en' ? 'Rename error' : 'Erreur lors du renommage'))
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
      setError(err?.response?.data?.message || (lang === 'en' ? 'Update error' : 'Erreur lors de la mise à jour'))
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
      setError(err?.response?.data?.message || (lang === 'en' ? 'Profile change error' : 'Erreur lors du changement de profil'))
    } finally {
      setChangingProfilId(null)
    }
  }

  const filtered = agents.filter((a) => {
    if (filterActive === 'active'   && a.is_active !== 1) return false
    if (filterActive === 'inactive' && a.is_active !== 0) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const uname = String(a.username ?? '').toLowerCase()
    const nomPresence = String(a.nom_presence ?? '').toLowerCase()
    const p = String(a.profil ?? '').toLowerCase()
    return (
      uname.includes(q) ||
      nomPresence.includes(q) ||
      p.includes(q)
    )
  })

  return (
    <div className="presence-page">
      {/* Header */}
      <header className="presence-header">
        <div className="header-left">
          <span className="header-logo">👥</span>
          <span className="header-title">{lang === 'en' ? 'Agents — Presence Mapping' : 'Agents — Mapping présence'}</span>
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
              <span className="btn-manager-link btn-manager-link--active">{lang === 'en' ? '👥 Agents' : '👥 Agents'}</span>
              {canOpenCrmRecap && <Link to="/manager/crm-recap" className="btn-manager-link">{lang === 'en' ? '📈 CRM Recap' : '📈 CRM Récap'}</Link>}
            </>
          ) : (
            <>
              <Link to="/pointer" className="btn-manager-link">{lang === 'en' ? '⏱ Clock' : '⏱ Pointer'}</Link>
              <Link to="/manager/day" className="btn-manager-link">{lang === 'en' ? '📅 Day View' : '📅 Journée'}</Link>
              <span className="btn-manager-link btn-manager-link--active">{lang === 'en' ? '👥 Agents' : '👥 Agents'}</span>
              {canOpenCrmRecap && <Link to="/manager/crm-recap" className="btn-manager-link">{lang === 'en' ? '📈 CRM Recap' : '📈 CRM Récap'}</Link>}
            </>
          )}
          <button className="btn-logout" onClick={() => dispatch(logout())}>{lang === 'en' ? 'Logout' : 'Déconnexion'}</button>
        </div>
      </header>

      <div className="manager-layout">

        {/* Barre d'outils — style overview-toolbar */}
        <div className="overview-toolbar">

          {/* Sélecteur bureau admin */}
          {canSelectBureau && (
            <div className="bureau-select-control">
              <label htmlFor="bureau-select-agents">🏢 Bureau</label>
              <select
                id="bureau-select-agents"
                className="bureau-select"
                value={isAdmin && showAllBureaux ? 'all' : activeBureauId}
                onChange={(e) => {
                  if (isAdmin && e.target.value === 'all') {
                    setShowAllBureaux(true)
                    setSelectedBureauId(0)
                  } else {
                    setShowAllBureaux(false)
                    setSelectedBureauId(Number(e.target.value))
                  }
                }}
              >
                {isAdmin && <option value="all">{lang === 'en' ? 'All offices' : 'Tous les bureaux'}</option>}
                {bureauOptions.map((id) => (
                  <option key={id} value={id}>{getBureauLabel(id)}</option>
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

          {isTodTenant && (
            <button className="btn-create-agent" onClick={openCreateAgent}>
              ➕ {lang === 'en' ? 'Create agent' : 'Créer un agent'}
            </button>
          )}
        </div>

        {error && <div className="alert-error">{error}</div>}

        {/* Compteur */}
        <div className="agent-map-count">
            {loading ? '...' : `${filtered.length} ${lang === 'en' ? `agent${filtered.length > 1 ? 's' : ''}` : `agent${filtered.length > 1 ? 's' : ''}`}`}
        </div>

        {/* Table */}
        {loading ? (
          <div className="loading-state">{lang === 'en' ? 'Loading...' : 'Chargement...'}</div>
        ) : (
          <div className="agents-table">
            <div className="agents-table-header agents-table-header--map">
              <span>{lang === 'en' ? 'User' : 'Utilisateur'}</span>
              <span>{lang === 'en' ? 'Presence name' : 'Nom présence'}</span>
              <span>{lang === 'en' ? 'Office' : 'Bureau'}</span>
              <span>{lang === 'en' ? 'Profile' : 'Profil'}</span>
              <span>{lang === 'en' ? 'Status' : 'Statut'}</span>
              <span></span>
            </div>

            {filtered.length === 0 ? (
              <div className="agents-empty">{lang === 'en' ? 'No agents found' : 'Aucun agent trouvé'}</div>
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
                      {bureauNameMap[agent.bureau_id] ?? `#${agent.bureau_id}`}
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
                      🏷️ {lang === 'en' ? 'Rename' : 'Renommer'}
                    </button>
                    <button
                      className={`btn-agent-toggle ${agent.is_active === 1 ? 'btn-agent-toggle--off' : 'btn-agent-toggle--on'}`}
                      onClick={() => handleToggleActive(agent)}
                      disabled={togglingId === agent.user_id}
                    >
                      {togglingId === agent.user_id
                        ? '...'
                        : agent.is_active === 1 ? (lang === 'en' ? 'Deactivate' : 'Désactiver') : (lang === 'en' ? 'Activate' : 'Activer')
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
              <h3>{lang === 'en' ? 'Rename — ' : 'Renommer — '}<span className="modal-agent-name">{renamingAgent.username}</span></h3>
              <button className="modal-close" onClick={closeRename}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="nom-presence">{lang === 'en' ? 'Presence name' : 'Nom de présence'}</label>
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
                {renaming ? (lang === 'en' ? 'Saving...' : 'Sauvegarde...') : (lang === 'en' ? 'Confirm' : 'Confirmer')}
              </button>
              <button className="btn-cancel-note" onClick={closeRename}>{lang === 'en' ? 'Cancel' : 'Annuler'}</button>
            </div>
          </div>
        </div>
      )}
      {/* Modal créer agent (tod only) */}
      {showCreateAgent && (
        <div className="modal-overlay" onClick={closeCreateAgent}>
          <div className="modal-box modal-box--md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{lang === 'en' ? '\u2795 Create agent' : '\u2795 Créer un agent'}</h3>
              <button className="modal-close" onClick={closeCreateAgent}>✕</button>
            </div>
            <div className="modal-body">

              <div className="form-group">
                <label>Username *</label>
                <input
                  type="text"
                  className="rename-input"
                  value={createForm.username}
                  onChange={(e) => setCreateForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="jean.dupont"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label>{lang === 'en' ? 'Password *' : 'Mot de passe *'}</label>
                <input
                  type="password"
                  className="rename-input"
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                />
              </div>

              <div className="form-group">
                <label>Profil</label>
                <select
                  className="bureau-select"
                  value={createForm.profil}
                  onChange={(e) => setCreateForm((f) => ({ ...f, profil: e.target.value }))}
                >
                  <option value="agent">Agent</option>
                  <option value="support">Support</option>
                  <option value="manager">Manager</option>
                  <option value="crm_manager">CRM Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="form-group">
                <label>{lang === 'en' ? 'Offices * (multiple selection)' : 'Bureaux * (sélection multiple)'}</label>
                <select
                  className="bureau-select"
                  multiple
                  value={createForm.bureauxIds.map(String)}
                  onChange={(e) => {
                    const selected = Array.from(e.target.selectedOptions).map((o) => Number(o.value))
                    setCreateForm((f) => ({ ...f, bureauxIds: selected }))
                  }}
                  style={{ height: '90px' }}
                >
                  {bureauOptions.map((id) => (
                    <option key={id} value={id}>{getBureauLabel(id)}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label>Nom de présence</label>
                <input
                  type="text"
                  className="rename-input"
                  value={createForm.nom_presence}
                  onChange={(e) => setCreateForm((f) => ({ ...f, nom_presence: e.target.value }))}
                  placeholder="Jean D. (défaut = username)"
                />
              </div>

              {createError && <div className="alert-error" style={{ marginTop: '8px' }}>{createError}</div>}
            </div>
            <div className="modal-footer">
              <button
                className="btn-save-note"
                onClick={handleCreateAgent}
                disabled={creating}
              >
                {creating ? (lang === 'en' ? 'Creating...' : 'Création...') : (lang === 'en' ? 'Create' : 'Créer')}
              </button>
              <button className="btn-cancel-note" onClick={closeCreateAgent}>{lang === 'en' ? 'Cancel' : 'Annuler'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AgentMapList
