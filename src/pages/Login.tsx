import React, { useState } from 'react'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import { loginAsync } from '../features/auth/authSlice'
import { Navigate } from 'react-router-dom'

const Login: React.FC = () => {
  const dispatch = useAppDispatch()
  const { isAuthenticated, loading, error } = useAppSelector((s) => s.auth)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code2fa, setCode2fa] = useState('')
  const [show2fa, setShow2fa] = useState(false)

  if (isAuthenticated) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const result = await dispatch(loginAsync({ username, password, code2fa: code2fa || undefined }))
    if (loginAsync.rejected.match(result)) {
      const msg = result.payload as string
      if (msg?.toLowerCase().includes('2fa') || msg?.toLowerCase().includes('code')) {
        setShow2fa(true)
      }
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">⏱</div>
          <h1>Pointage</h1>
          <p>Connectez-vous pour enregistrer votre présence</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="username">Nom d'utilisateur</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Votre identifiant"
              required
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Votre mot de passe"
              required
              autoComplete="current-password"
            />
          </div>

          {show2fa && (
            <div className="form-group">
              <label htmlFor="code2fa">Code 2FA</label>
              <input
                id="code2fa"
                type="text"
                value={code2fa}
                onChange={(e) => setCode2fa(e.target.value)}
                placeholder="Code à 6 chiffres"
                maxLength={6}
                autoComplete="one-time-code"
              />
            </div>
          )}

          <button type="submit" className="btn-login" disabled={loading}>
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
