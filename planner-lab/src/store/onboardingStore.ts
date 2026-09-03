// Lightweight coordinator for the guided walkthrough. The tour overlay lives in
// DashboardLayout; the Help button (and the first-visit effect) trigger it here.
import { create } from 'zustand'

interface OnboardingState {
  tourActive: boolean
  startTour: () => void
  stopTour: () => void
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  tourActive: false,
  startTour: () => set({ tourActive: true }),
  stopTour: () => set({ tourActive: false }),
}))

/** Per-user localStorage flag so the artist walkthrough only auto-runs once. */
export const tourSeenKey = (userId?: string | null) => `aa_artist_tour_v1:${userId ?? 'anon'}`

export function hasSeenArtistTour(userId?: string | null): boolean {
  try {
    return localStorage.getItem(tourSeenKey(userId)) === '1'
  } catch {
    return true // storage blocked (private mode) — don't nag every load
  }
}

export function markArtistTourSeen(userId?: string | null): void {
  try {
    localStorage.setItem(tourSeenKey(userId), '1')
  } catch {
    /* ignore */
  }
}
