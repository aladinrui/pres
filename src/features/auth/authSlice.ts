import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit'
import axios from 'axios'
import { clearUserDetail, decodeTokenPayload, setUserDetail } from '../user/userSlice'

type LoginPayload = { username: string; password: string; code2fa?: string }

type AuthState = {
  isAuthenticated: boolean
  loading: boolean
  error: string | null
  token: string | null
}

const TOKEN_KEY = 'pr_token'

const tokenFromStorage = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY) || null
  } catch {
    return null
  }
})()

const initialState: AuthState = {
  isAuthenticated: !!tokenFromStorage,
  loading: false,
  error: null,
  token: tokenFromStorage,
}

if (tokenFromStorage) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${tokenFromStorage}`
}

const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000') + '/api'

export const loginAsync = createAsyncThunk(
  'auth/login',
  async (payload: LoginPayload, { rejectWithValue, dispatch }) => {
    try {
      const res = await axios.post(`${API_URL}/auth/login`, payload)
      const token = res.data?.token
      const user = res.data?.user

      if (token) {
        const decoded = decodeTokenPayload(token)
        const mergedDetail = user ? { ...decoded, ...user } : decoded
        if (mergedDetail) {
          dispatch(setUserDetail(mergedDetail))
        } else {
          dispatch(clearUserDetail())
        }
      } else {
        dispatch(clearUserDetail())
      }
      return res.data
    } catch (err: any) {
      dispatch(clearUserDetail())
      const message = err?.response?.data?.message || err.message || 'Erreur de connexion'
      return rejectWithValue(message)
    }
  }
)

export const logout = createAsyncThunk('auth/logout', async (_, { dispatch }) => {
  dispatch(clearUserDetail())
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {}
  delete axios.defaults.headers.common['Authorization']
})

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(loginAsync.pending, (state) => {
      state.loading = true
      state.error = null
    })
    builder.addCase(loginAsync.fulfilled, (state, action: PayloadAction<any>) => {
      state.loading = false
      state.isAuthenticated = true
      state.token = action.payload?.token || null
      try {
        if (action.payload?.token) {
          localStorage.setItem(TOKEN_KEY, action.payload.token)
          axios.defaults.headers.common['Authorization'] = `Bearer ${action.payload.token}`
        }
      } catch {}
    })
    builder.addCase(loginAsync.rejected, (state, action) => {
      state.loading = false
      state.isAuthenticated = false
      state.token = null
      try {
        localStorage.removeItem(TOKEN_KEY)
      } catch {}
      delete axios.defaults.headers.common['Authorization']
      state.error = (action.payload as string) || action.error?.message || 'Échec de la connexion'
    })
    builder.addCase(logout.fulfilled, (state) => {
      state.loading = false
      state.isAuthenticated = false
      state.token = null
      state.error = null
    })
  },
})

export default authSlice.reducer
