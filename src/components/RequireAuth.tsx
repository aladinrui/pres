import React from 'react'
import { useSelector } from 'react-redux'
import { Navigate, useLocation } from 'react-router-dom'
import { RootState } from '../store/index'

const RequireAuth: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated)
  const isActive = useSelector((state: RootState) => state.user.userDetail?.is_active)
  const location = useLocation()

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Utilisateur non whitelisté en base → écran blanc
  if (isActive === 0 || isActive === false) {
    return <div style={{ display: 'none' }} />
  }

  return children
}

export default RequireAuth
