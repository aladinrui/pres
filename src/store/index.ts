import { configureStore } from '@reduxjs/toolkit'
import authReducer from '../features/auth/authSlice'
import userReducer from '../features/user/userSlice'
import presenceReducer from '../features/presence/presenceSlice'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    user: userReducer,
    presence: presenceReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export default store
