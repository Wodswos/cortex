/**
 * 平台能力适配(D6:原生本地通知先行,web 端尽力而为)。
 * web:Notification API(需安全上下文与授权;iOS PWA 在 HTTPS 安装后可用,见 RUNBOOK)。
 * Tauri/Capacitor 壳(M5/M7)在原生侧替换 notify 实现(见 apps/{desktop,mobile})。
 */

export type NotifPermission = 'granted' | 'denied' | 'unsupported' | 'default';

export function notifSupported(): boolean {
  return typeof Notification !== 'undefined';
}

export async function requestNotifPermission(): Promise<NotifPermission> {
  if (!notifSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return (await Notification.requestPermission()) as NotifPermission;
  } catch {
    return 'denied';
  }
}

export function notify(title: string, body?: string): void {
  if (!notifSupported() || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/icons/icon-192.png', tag: 'cortex', silent: false });
  } catch {
    /* PWA/SW 场景失败静默 */
  }
}

/** 播放短提示音(WebAudio,零音频资产) */
export function chime(kind: 'done' | 'break' = 'done'): void {
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = kind === 'done' ? [523.25, 659.25, 783.99] : [659.25, 523.25];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.55);
    });
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch {
    /* 无伤大雅 */
  }
}
