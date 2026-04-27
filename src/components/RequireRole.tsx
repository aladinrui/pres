import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAppSelector } from '../store/hooks'

type Props = {
  roles: string[]
  children: React.ReactElement
}

const RequireRole: React.FC<Props> = ({ roles, children }) => {
  const profil = (useAppSelector((s) => s.user.userDetail?.profil) ?? '').toLowerCase()

  if (!roles.map((r) => r.toLowerCase()).includes(profil)) {
    return <Navigate to="/" replace />
  }

  return children
}

export default RequireRole
