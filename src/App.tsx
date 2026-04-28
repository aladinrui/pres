import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Presence from './pages/Presence'
import PresenceOverview from './pages/PresenceOverview'
import ManagerDash from './pages/ManagerDash'
import AgentMapList from './pages/AgentMapList'
import RequireAuth from './components/RequireAuth'
import RequireRole from './components/RequireRole'
import { useAppSelector } from './store/hooks'

const IP_CHECK_URL = `${(import.meta.env.VITE_API_URL as string | undefined) ?? ''}/api/auth/hutdc264uy`

type IpCheckStatus = 'pending' | 'allowed' | 'denied'

const isIpCheckAllowed = (payload: unknown): boolean => {
  if (typeof payload === 'string') return payload.trim().toLowerCase() === 'ok'
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>
    const possibleStatus = record.status ?? record.result ?? record.ok
    if (typeof possibleStatus === 'string') return possibleStatus.trim().toLowerCase() === 'ok'
    if (typeof possibleStatus === 'boolean') return possibleStatus
  }
  return false
}

const MANAGER_ROLES    = ['man', 'manager', 'crm_manager', 'crm manager', 'admin', 'superadmin']
const ADMIN_ROLES      = ['admin', 'superadmin']
const DAY_ROLES        = ['man', 'manager', 'crm_manager', 'crm manager']

const ManagerRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RequireAuth>
    <RequireRole roles={MANAGER_ROLES}>{children}</RequireRole>
  </RequireAuth>
)

/** Redirige les admin/superadmin vers /manager, les managers vers /manager/day, laisse passer les autres (pointage perso) */
const HomeRoute: React.FC = () => {
  const profil = (useAppSelector((s) => s.user.userDetail?.profil as string | undefined) ?? '').toLowerCase()
  if (ADMIN_ROLES.includes(profil)) return <Navigate to="/manager" replace />
  if (DAY_ROLES.includes(profil)) return <Navigate to="/manager/day" replace />
  return <Presence />
}

/** Redirige les managers (non-admin) depuis /manager vers /manager/day */
const ManagerHomeRoute: React.FC = () => {
  const profil = (useAppSelector((s) => s.user.userDetail?.profil as string | undefined) ?? '').toLowerCase()
  if (!ADMIN_ROLES.includes(profil)) return <Navigate to="/manager/day" replace />
  return <PresenceOverview />
}

const App: React.FC = () => {
  const [ipCheckStatus, setIpCheckStatus] = useState<IpCheckStatus>('pending')

  useEffect(() => {
    // En développement local → pas de check IP
    if (import.meta.env.DEV) { setIpCheckStatus('allowed'); return }
    let isMounted = true
    const verifyIp = async () => {
      try {
        const response = await axios.post(IP_CHECK_URL)
        if (!isMounted) return
        const allowed = isIpCheckAllowed(response.data) || (response.status >= 200 && response.status < 300)
        setIpCheckStatus(allowed ? 'allowed' : 'denied')
      } catch {
        if (isMounted) setIpCheckStatus('denied')
      }
    }
    verifyIp()
    return () => { isMounted = false }
  }, [])

  if (ipCheckStatus === 'pending') return <div />

  if (ipCheckStatus === 'denied') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <h1>error 404</h1>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Pointage personnel — admin redirigé vers /manager */}
        <Route path="/" element={<RequireAuth><HomeRoute /></RequireAuth>} />
        <Route path="/pointer" element={<RequireAuth><Presence /></RequireAuth>} />

        {/* Manager / Admin uniquement */}
        <Route path="/manager" element={<ManagerRoute><ManagerHomeRoute /></ManagerRoute>} />
        <Route path="/manager/day" element={<ManagerRoute><ManagerDash /></ManagerRoute>} />
        <Route path="/manager/agents" element={<ManagerRoute><AgentMapList /></ManagerRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
