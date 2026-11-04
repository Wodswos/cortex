import { useEffect, useState } from 'react';
import type { MindFont, Task } from '@cortex/core';
import { DEFAULT_MIND_FONT } from './appearance';

const loaders: Partial<Record<MindFont, () => Promise<unknown>>> = {
  'noto-sans-sc': () => import('@fontsource-variable/noto-sans-sc'),
  'noto-serif-sc': () => import('@fontsource-variable/noto-serif-sc'),
  'lxgw-wenkai': () => Promise.all([import('@fontsource/lxgw-wenkai/500.css'), import('@fontsource/lxgw-wenkai/700.css')]),
  inter: () => import('@fontsource-variable/inter'),
  'jetbrains-mono': () => import('@fontsource-variable/jetbrains-mono'),
};
const pending = new Map<MindFont, Promise<unknown>>();
export function loadMindFont(font: MindFont): Promise<unknown> {
  let promise = pending.get(font);
  if (!promise) {
    promise = loaders[font]?.() ?? Promise.resolve();
    pending.set(font, promise);
    void promise.catch(() => pending.delete(font));
  }
  return promise;
}

/** Fonts are self-hosted and requested only when a map uses them. */
export function useMindFonts(tasks: Task[]) {
  const key = [...new Set([DEFAULT_MIND_FONT, ...tasks.map((task) => task.mindFontFamily).filter((font): font is MindFont => !!font)])].sort().join(',');
  const [loadedKey, setLoadedKey] = useState('');
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const fonts = key ? key.split(',') as MindFont[] : [];
    void Promise.all(fonts.map(loadMindFont)).then(async () => {
      // Give the inserted stylesheet and rendered text one frame to request glyph subsets.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await document.fonts.ready;
    }).catch(() => { if (!cancelled) setFailed(true); }).finally(() => {
      if (!cancelled) { setLoadedKey(key); setRevision((value) => value + 1); }
    });
    return () => { cancelled = true; };
  }, [key]);
  useEffect(() => {
    const ready = () => setRevision((value) => value + 1);
    document.fonts.addEventListener('loadingdone', ready);
    return () => document.fonts.removeEventListener('loadingdone', ready);
  }, []);
  return { ready: loadedKey === key, revision, failed };
}
