import { createSlice, PayloadAction } from '@reduxjs/toolkit'

export type TokenPayload = {
  userId?: number
  username?: string
  profil?: string | null
  bureau?: string | null
  bureau_id?: number | null
  bureaux?: { id?: number; name?: string }[]
  is_active?: number | boolean
  iat?: number
  exp?: number
  [key: string]: unknown
}

export type UserState = {
  userDetail: TokenPayload | null
}

const USER_KEY = 'pr_user'
const TOKEN_KEY = 'pr_token'

const readStoredToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

const readStoredUserDetail = (): TokenPayload | null => {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

const decodeBase64Url = (segment: string): string => {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const g = globalThis as any
  if (typeof g.atob === 'function') return g.atob(padded)
  if (g.Buffer) return g.Buffer.from(padded, 'base64').toString('utf-8')
  throw new Error('No base64 decoder available')
}

export const decodeTokenPayload = (token: string | null | undefined): TokenPayload | null => {
  if (!token) return null
  const segments = token.split('.')
  if (segments.length < 2) return null
  try {
    const decoded = decodeBase64Url(segments[1])
    const parsed = JSON.parse(decoded)
    if (typeof parsed !== 'object' || parsed === null) return null

    const normalized: TokenPayload = { ...(parsed as Record<string, unknown>) }

    if (typeof normalized.userId !== 'number') {
      const coerced = Number(
        (parsed as any).userId ?? (parsed as any).user_id ?? (parsed as any).id
      )
      if (!Number.isNaN(coerced)) normalized.userId = coerced
    }

    if (normalized.username && typeof normalized.username !== 'string') {
      normalized.username = String(normalized.username)
    }

    // Extraire bureau_id depuis les bureaux si non présent
    if (!normalized.bureau_id && Array.isArray(normalized.bureaux) && normalized.bureaux.length > 0) {
      normalized.bureau_id = normalized.bureaux[0].id ?? null
    }

    return normalized
  } catch {
    return null
  }
}

const initialState: UserState = {
  userDetail: readStoredUserDetail() ?? decodeTokenPayload(readStoredToken()),
}

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUserDetail(state, action: PayloadAction<TokenPayload | null>) {
      state.userDetail = action.payload ?? null
      try {
        if (action.payload) {
          localStorage.setItem(USER_KEY, JSON.stringify(action.payload))
        } else {
          localStorage.removeItem(USER_KEY)
        }
      } catch {}
    },
    clearUserDetail(state) {
      state.userDetail = null
      try {
        localStorage.removeItem(USER_KEY)
      } catch {}
    },
  },
})

export const { setUserDetail, clearUserDetail } = userSlice.actions
export default userSlice.reducer
