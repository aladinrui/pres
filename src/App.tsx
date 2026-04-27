import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import Presence from './pages/Presence'
import PresenceOverview from './pages/PresenceOverview'
import ManagerDash from './pages/ManagerDash'
import AgentMapList from './pages/AgentMapList'
import RequireAuth from './components/RequireAuth'
import RequireRole from './components/RequireRole'
import { useAppSelector } from './store/hooks'

const MANAGER_ROLES = ['manager', 'admin', 'superadmin']
const ADMIN_ROLES   = ['admin', 'superadmin']

const ManagerRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <RequireAuth>
    <RequireRole roles={MANAGER_ROLES}>{children}</RequireRole>
  </RequireAuth>
)

/** Redirige les admin/superadmin vers /manager, laisse passer les autres */
const HomeRoute: React.FC = () => {
  const profil = useAppSelector((s) => (s.user.userDetail?.profil as string | undefined) ?? '')
  if (ADMIN_ROLES.includes(profil)) {
    return <Navigate to="/manager" replace />
  }
  return <Presence />
}

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Pointage personnel — admin redirigé vers /manager */}
        <Route path="/" element={<RequireAuth><HomeRoute /></RequireAuth>} />

        {/* Manager / Admin uniquement */}
        <Route path="/manager" element={<ManagerRoute><PresenceOverview /></ManagerRoute>} />
        <Route path="/manager/annotate" element={<ManagerRoute><ManagerDash /></ManagerRoute>} />
        <Route path="/manager/agents" element={<ManagerRoute><AgentMapList /></ManagerRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
