export function withAlpha(hexColor: string, alpha: number): string {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const rgb = hexToRgb(hexColor);
  if (!rgb) return `rgba(0,0,0,${clampedAlpha})`;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${clampedAlpha})`;
}

export function readableTextColor(backgroundHex: string, light = '#FFFFFF', dark = '#0F172A'): string {
  const rgb = hexToRgb(backgroundHex);
  if (!rgb) return light;
  const toLinear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
  return luminance > 0.52 ? dark : light;
}

function hexToRgb(hexColor: string): { r: number; g: number; b: number } | null {
  const hex = hexColor.replace('#', '').trim();
  if (hex.length !== 3 && hex.length !== 6) return null;
  const normalized =
    hex.length === 3
      ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
      : hex;
  const parsed = Number.parseInt(normalized, 16);
  if (Number.isNaN(parsed)) return null;
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}
