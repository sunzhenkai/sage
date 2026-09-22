import { create } from 'zustand'

type AppState = {
  ready: boolean
}

export const useAppStore = create<AppState>(() => ({
  ready: false,
}))
