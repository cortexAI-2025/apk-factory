'use client';
import { create } from 'zustand';
import { User } from '../types';
import { authApi } from '../api';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
  loadProfile: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  token: typeof window !== 'undefined' ? localStorage.getItem('apk_factory_token') : null,
  loading: false,

  setAuth: (user, token) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('apk_factory_token', token);
    }
    set({ user, token });
  },

  clearAuth: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('apk_factory_token');
    }
    set({ user: null, token: null });
  },

  loadProfile: async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('apk_factory_token') : null;
    if (!token) return;
    set({ loading: true });
    try {
      const user = await authApi.profile();
      set({ user, loading: false });
    } catch {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('apk_factory_token');
      }
      set({ user: null, token: null, loading: false });
    }
  },
}));
