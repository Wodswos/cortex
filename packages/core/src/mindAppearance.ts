/** Optional, field-level task presentation. Null restores the theme default. */
export const MIND_PALETTE = ['neutral', 'blue', 'sage', 'sand', 'rose', 'lavender'] as const;
export type MindColor = (typeof MIND_PALETTE)[number] | `#${string}`;
export const MIND_FONT_KEYS = ['sans', 'serif', 'mono', 'noto-sans-sc', 'noto-serif-sc', 'lxgw-wenkai', 'inter', 'jetbrains-mono'] as const;
export type MindFont = (typeof MIND_FONT_KEYS)[number];
export interface MindAppearance {
  mindBackground?: MindColor | null;
  mindTextColor?: MindColor | null;
  mindFontFamily?: MindFont | null;
  mindFontSize?: number | null;
  mindBold?: boolean | null;
  mindItalic?: boolean | null;
}
export const MIND_APPEARANCE_FIELDS = ['mindBackground', 'mindTextColor', 'mindFontFamily', 'mindFontSize', 'mindBold', 'mindItalic'] as const;
export const RESET_MIND_APPEARANCE: MindAppearance = Object.fromEntries(MIND_APPEARANCE_FIELDS.map((field) => [field, null]));

/** Never accept arbitrary CSS from backups or mutations. Older tasks omit every field. */
export function validateMindAppearance(value: object): void {
  const fields = value as Record<string, unknown>;
  for (const key of MIND_APPEARANCE_FIELDS) {
    const item = fields[key];
    if (item == null) continue;
    const valid = key === 'mindBackground' || key === 'mindTextColor'
      ? typeof item === 'string' && (MIND_PALETTE.includes(item as typeof MIND_PALETTE[number]) || /^#[0-9a-f]{6}$/i.test(item))
      : key === 'mindFontFamily' ? typeof item === 'string' && MIND_FONT_KEYS.includes(item as MindFont)
        : key === 'mindFontSize' ? typeof item === 'number' && Number.isInteger(item) && item >= 10 && item <= 32
          : typeof item === 'boolean';
    if (!valid) throw new Error(`数据格式错误: task.${key}`);
  }
}

export function mindAppearanceOf(value: MindAppearance): MindAppearance {
  validateMindAppearance(value);
  return Object.fromEntries(MIND_APPEARANCE_FIELDS.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]));
}
