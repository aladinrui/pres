import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import axios from 'axios'
import type { RootState } from '../../store'

const API = ((import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:4000') + '/api'

const BUREAU_IDS_ALL = [3, 4, 5, 6, 7, 8, 9, 10]

// ── Types ──────────────────────────────────────────────────────────────────

export type PresenceLog = {
  id: number
  type: 'in' | 'out'
  timestamp: string
  note: string | null
  ip_address: string | null
}

export type UserDay = {
  user_id: number
  username: string
  profil?: string
  is_active?: number | boolean
  status: 'present' | 'absent' | 'partial' | 'conge' | null
  note: string | null
  daily_id: number | null
  logs: PresenceLog[]
  last_action: 'in' | 'out' | null
}

export type DayEntry = { date: string; users: UserDay[] }
export type BureauDayResponse = {
  bureau_id: number
  date_from: string
  date_to: string
  days: DayEntry[]
}

export type AlertAgent = {
  user_id: number
  username: string
  bureau_id: number
  profil: string | null
  status: 'non_pointe' | 'absent' | 'retard' | 'conge'
  note: string | null
  updated_at: string | null
  checkin_time: string | null   // ex: "10:32:00" — heure réelle d'arrivée
  schedule_start: string | null // ex: "09:00:00" — heure prévue
}
export type AlertsResponse = {
  date: string
  bureau_id: number | null
  total: number
  counts?: {
    non_pointe?: number
    retard?: number
    absent?: number
    conge?: number
  }
  agents: AlertAgent[]
}

type PresenceState = {
  // Manager bureau day view (filtrée par bureau_id du manager)
  bureauDay: BureauDayResponse | null
  bureauDayLoading: boolean
  bureauDayError: string | null

  // Alertes du jour
  alerts: AlertsResponse | null
  alertsLoading: boolean
  alertsError: string | null

  // Admin — toutes les données par bureau
  allBureauxData: Record<number, UserDay[]>
  allBureauxLoading: boolean

  // Date et seuil sélectionnés (persistés en Redux pour éviter reset à la navigation)
  selectedDate: string
  threshold: string
}

function todayISO() { return new Date().toISOString().slice(0, 10) }

const initialState: PresenceState = {
  bureauDay: null,
  bureauDayLoading: false,
  bureauDayError: null,
  alerts: null,
  alertsLoading: false,
  alertsError: null,
  allBureauxData: {},
  allBureauxLoading: false,
  selectedDate: todayISO(),
  threshold: '10:00',
}

// ── Thunks ─────────────────────────────────────────────────────────────────

/** Charge les agents du bureau du manager pour une date donnée */
export const fetchBureauDay = createAsyncThunk(
  'presence/fetchBureauDay',
  async (date: string, { getState, rejectWithValue }) => {
    const state = getState() as RootState
    const user  = state.user.userDetail
    const bureauId = user?.bureau_id ?? (user?.bureaux?.[0] as any)?.id ?? 0
    if (!bureauId) return rejectWithValue('Aucun bureau_id disponible')
    try {
      const res = await axios.post<BureauDayResponse>(`${API}/presence/by-bureau-day`, {
        bureau_id: bureauId,
        date_from: date,
        date_to: date,
      })
      return res.data
    } catch (err: any) {
      return rejectWithValue(err?.response?.data?.message || 'Erreur lors du chargement')
    }
  }
)

/** Charge les alertes du jour (tous bureaux pour admin, bureau du manager sinon) */
export const fetchAlerts = createAsyncThunk(
  'presence/fetchAlerts',
  async (_, { getState, rejectWithValue }) => {
    const state    = getState() as RootState
    const user     = state.user.userDetail
    const profil   = (user?.profil as string) ?? ''
    const isAdmin  = profil === 'admin' || profil === 'superadmin'
    const bureauId = user?.bureau_id ?? (user?.bureaux?.[0] as any)?.id ?? 0
    try {
      const url = isAdmin
        ? `${API}/presence/today/alerts`
        : `${API}/presence/today/alerts?bureau_id=${bureauId}`
      const res = await axios.get<AlertsResponse>(url)
      return res.data
    } catch (err: any) {
      return rejectWithValue(err?.response?.data?.message || 'Erreur')
    }
  }
)

/** Admin — charge les agents de tous les bureaux en parallèle */
export const fetchAllBureauxData = createAsyncThunk(
  'presence/fetchAllBureauxData',
  async (_, { rejectWithValue }) => {
    try {
      const today = todayISO()
      const results = await Promise.allSettled(
        BUREAU_IDS_ALL.map(async (bureau_id) => {
          const res = await axios.post<BureauDayResponse>(`${API}/presence/by-bureau-day`, {
            bureau_id,
            date_from: today,
            date_to: today,
          })
          return { bureau_id, users: res.data.days?.[0]?.users ?? [] }
        })
      )
      const data: Record<number, UserDay[]> = {}
      results.forEach((r) => {
        if (r.status === 'fulfilled') data[r.value.bureau_id] = r.value.users
      })
      return data
    } catch (err: any) {
      return rejectWithValue(err?.response?.data?.message || 'Erreur')
    }
  }
)

// ── Slice ──────────────────────────────────────────────────────────────────

const presenceSlice = createSlice({
  name: 'presence',
  initialState,
  reducers: {
    setSelectedDate(state, action) { state.selectedDate = action.payload },
    setThreshold(state, action)    { state.threshold    = action.payload },
  },
  extraReducers: (builder) => {
    // fetchBureauDay
    builder
      .addCase(fetchBureauDay.pending,   (state) => { state.bureauDayLoading = true;  state.bureauDayError = null })
      .addCase(fetchBureauDay.fulfilled, (state, action) => { state.bureauDayLoading = false; state.bureauDay = action.payload })
      .addCase(fetchBureauDay.rejected,  (state, action) => { state.bureauDayLoading = false; state.bureauDayError = action.payload as string })

    // fetchAlerts
    builder
      .addCase(fetchAlerts.pending,   (state) => { state.alertsLoading = true;  state.alertsError = null })
      .addCase(fetchAlerts.fulfilled, (state, action) => { state.alertsLoading = false; state.alerts = action.payload })
      .addCase(fetchAlerts.rejected,  (state, action) => { state.alertsLoading = false; state.alertsError = action.payload as string })

    // fetchAllBureauxData
    builder
      .addCase(fetchAllBureauxData.pending,   (state) => { state.allBureauxLoading = true })
      .addCase(fetchAllBureauxData.fulfilled, (state, action) => { state.allBureauxLoading = false; state.allBureauxData = action.payload })
      .addCase(fetchAllBureauxData.rejected,  (state) => { state.allBureauxLoading = false })
  },
})

export const { setSelectedDate, setThreshold } = presenceSlice.actions
export default presenceSlice.reducer
