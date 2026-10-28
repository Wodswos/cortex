import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Accent, ACCENTS } from '@cortex/core';

type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeState {
  mode: ThemeMode;
  accent: Accent;
  setMode: (m: ThemeMode) => void;
  setAccent: (a: Accent) => void;
}

function apply(mode: ThemeMode, accent: Accent): void {
  const el = document.documentElement;
  const dark =
    mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  el.classList.toggle('dark', dark);
  el.dataset.accent = ACCENTS.includes(accent) ? accent : 'cyan-violet';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#1b1d21' : '#ffffff');
}

export const useTheme = create<ThemeState>()(
  persist(
    () => ({
      mode: 'system' as ThemeMode,
      accent: 'cyan-violet' as Accent,
      setMode: (mode: ThemeMode) => {
        useTheme.setState({ mode });
        apply(mode, useTheme.getState().accent);
      },
      setAccent: (accent: Accent) => {
        useTheme.setState({ accent });
        apply(useTheme.getState().mode, accent);
      },
    }),
    {
      name: 'cortex-theme',
      onRehydrateStorage: () => (state) => {
        if (state) apply(state.mode, state.accent);
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
          apply(useTheme.getState().mode, useTheme.getState().accent);
        });
      },
    },
  ),
);
