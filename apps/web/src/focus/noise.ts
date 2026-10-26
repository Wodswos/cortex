/**
 * 白噪音(WebAudio 合成,零音频资产):rain = 高通白噪,brown = 布朗噪声,
 * cafe = 布朗 + 慢速音量起伏。Timer store 只存选择,这里管播放生命周期。
 */
import { useTimer } from './timer';

let ctx: AudioContext | null = null;
let src: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
let lfoTimer: ReturnType<typeof setInterval> | null = null;

function makeBuffer(kind: 'rain' | 'brown' | 'cafe'): AudioBuffer {
  const sr = 44100;
  const len = sr * 4;
  const buf = ctx!.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'rain') {
      data[i] = white * 0.25 + (data[i - 1] ?? 0) * 0.1;
    } else {
      // brown / cafe:积分白噪
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.2;
    }
  }
  return buf;
}

export function stopNoise(): void {
  if (lfoTimer) clearInterval(lfoTimer);
  lfoTimer = null;
  try {
    src?.stop();
  } catch {
    /* already stopped */
  }
  src = null;
  gain = null;
  ctx?.close().catch(() => {});
  ctx = null;
}

export function playNoise(kind: 'rain' | 'brown' | 'cafe'): void {
  stopNoise();
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  src = ctx.createBufferSource();
  src.buffer = makeBuffer(kind);
  src.loop = true;
  gain = ctx.createGain();
  gain.gain.value = 0.18;
  src.connect(gain).connect(ctx.destination);
  src.start();
  if (kind === 'cafe') {
    // 慢速人声起伏
    lfoTimer = setInterval(() => {
      if (!gain || !ctx) return;
      gain.gain.setTargetAtTime(0.1 + Math.random() * 0.14, ctx.currentTime, 1.5);
    }, 3000);
  }
}

let last: string = 'off';
useTimer.subscribe((s) => {
  const noise = s.noise;
  if (noise === last) return;
  last = noise;
  if (noise === 'off') stopNoise();
  else if (s.status === 'running') playNoise(noise);
});
// 运行状态变化时启停
let lastStatus: string = 'idle';
useTimer.subscribe((s) => {
  if (s.status === lastStatus) return;
  lastStatus = s.status;
  if (s.status === 'running' && s.noise !== 'off') playNoise(s.noise);
  else if (s.status !== 'running' && s.noise !== 'off') {
    stopNoise();
    // 保持选择,只是暂停
  }
});
