#!/usr/bin/env node
/**
 * 生成 PWA 图标(无 ImageMagick 依赖,纯 Node PNG 编码)。
 * 512 母版超采样 → 盒式降采样出 192/180/32;输出 apps/web/public/icons/。
 * 图案:雾蓝圆角方 + 白色勾选,与 favicon 和侧栏品牌一致。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 绘制 ----------
const SS = 4; // 超采样
const SIZE = 512;

// 勾选多边形(归一化 0..1 坐标)
const CHECK = [[0.24, 0.47], [0.42, 0.65], [0.72, 0.31], [0.79, 0.37], [0.43, 0.76], [0.18, 0.53]];
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const N = SIZE * SS;
const master = Buffer.alloc(SIZE * SIZE * 4);
const radius = 0.22 * SIZE;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 超采样累积
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x * SS + sx + 0.5;
        const py = y * SS + sy + 0.5;
        // 圆角裁剪
        const cx = Math.min(Math.max(px / SS, radius), SIZE - radius);
        const cy = Math.min(Math.max(py / SS, radius), SIZE - radius);
        const dx = px / SS - cx;
        const dy = py / SS - cy;
        const inRounded = dx * dx + dy * dy <= radius * radius;
        if (!inRounded) continue;
        let cr = 83, cg = 117, cb = 180;
        if (inPoly(px / SS / SIZE, py / SS / SIZE, CHECK)) {
          cr = 255; cg = 255; cb = 255;
        }
        r += cr; g += cg; b += cb; a += 255;
      }
    }
    const n = SS * SS;
    const i = (y * SIZE + x) * 4;
    master[i] = Math.round(r / n);
    master[i + 1] = Math.round(g / n);
    master[i + 2] = Math.round(b / n);
    master[i + 3] = Math.round(a / n);
  }
}

function downsample(target) {
  const factor = SIZE / target;
  const out = Buffer.alloc(target * target * 4);
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      let r = 0, g = 0, b = 0, a = 0, count = 0;
      const x0 = Math.floor(x * factor);
      const x1 = Math.min(SIZE, Math.floor((x + 1) * factor));
      const y0 = Math.floor(y * factor);
      const y1 = Math.min(SIZE, Math.floor((y + 1) * factor));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * SIZE + xx) * 4;
          r += master[i] * (master[i + 3] / 255);
          g += master[i + 1] * (master[i + 3] / 255);
          b += master[i + 2] * (master[i + 3] / 255);
          a += master[i + 3];
          count++;
        }
      }
      const i = (y * target + x) * 4;
      const alpha = a / count / 255;
      out[i] = count ? Math.round(r / count / (alpha || 1)) : 0;
      out[i + 1] = count ? Math.round(g / count / (alpha || 1)) : 0;
      out[i + 2] = count ? Math.round(b / count / (alpha || 1)) : 0;
      out[i + 3] = Math.round(a / count);
    }
  }
  return out;
}

for (const size of [512, 192, 180, 32]) {
  const png = encodePNG(size, size, size === SIZE ? master : downsample(size));
  writeFileSync(join(OUT, `icon-${size}.png`), png);
  console.log(`✓ icon-${size}.png (${png.length} bytes)`);
}
