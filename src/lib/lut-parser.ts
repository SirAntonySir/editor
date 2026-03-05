export interface LUTData {
  title: string;
  size: number;
  data: Float32Array;
}

export function parseCubeFile(content: string): LUTData {
  const lines = content.split('\n');
  let title = 'Untitled';
  let size = 0;
  const values: number[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('TITLE')) {
      title = trimmed.replace(/^TITLE\s+"?/, '').replace(/"?\s*$/, '');
      continue;
    }
    if (trimmed.startsWith('LUT_3D_SIZE')) {
      size = parseInt(trimmed.split(/\s+/)[1], 10);
      continue;
    }
    if (trimmed.startsWith('DOMAIN_MIN') || trimmed.startsWith('DOMAIN_MAX')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        values.push(r, g, b);
      }
    }
  }

  if (size === 0) {
    size = Math.round(Math.cbrt(values.length / 3));
  }

  return {
    title,
    size,
    data: new Float32Array(values),
  };
}

// Built-in preset LUT generators
export function generateIdentityLUT(size: number = 33): LUTData {
  const data = new Float32Array(size * size * size * 3);
  let idx = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[idx++] = r / (size - 1);
        data[idx++] = g / (size - 1);
        data[idx++] = b / (size - 1);
      }
    }
  }
  return { title: 'Identity', size, data };
}

export function generateWarmLUT(size: number = 33): LUTData {
  const base = generateIdentityLUT(size);
  for (let i = 0; i < base.data.length; i += 3) {
    base.data[i] = Math.min(1, base.data[i] * 1.1 + 0.02);
    base.data[i + 2] = Math.max(0, base.data[i + 2] * 0.9 - 0.01);
  }
  return { ...base, title: 'Warm' };
}

export function generateCoolLUT(size: number = 33): LUTData {
  const base = generateIdentityLUT(size);
  for (let i = 0; i < base.data.length; i += 3) {
    base.data[i] = Math.max(0, base.data[i] * 0.9 - 0.01);
    base.data[i + 2] = Math.min(1, base.data[i + 2] * 1.1 + 0.02);
  }
  return { ...base, title: 'Cool' };
}

export function generateVintageLUT(size: number = 33): LUTData {
  const base = generateIdentityLUT(size);
  for (let i = 0; i < base.data.length; i += 3) {
    const r = base.data[i], g = base.data[i + 1], b = base.data[i + 2];
    // Slight sepia shift + reduced contrast
    base.data[i] = Math.min(1, r * 0.85 + 0.1);
    base.data[i + 1] = Math.min(1, g * 0.8 + 0.05);
    base.data[i + 2] = Math.min(1, b * 0.7 + 0.03);
  }
  return { ...base, title: 'Vintage' };
}

export function generateBWLUT(size: number = 33): LUTData {
  const base = generateIdentityLUT(size);
  for (let i = 0; i < base.data.length; i += 3) {
    const lum = base.data[i] * 0.2126 + base.data[i + 1] * 0.7152 + base.data[i + 2] * 0.0722;
    base.data[i] = lum;
    base.data[i + 1] = lum;
    base.data[i + 2] = lum;
  }
  return { ...base, title: 'B&W' };
}

export function generateHighContrastLUT(size: number = 33): LUTData {
  const base = generateIdentityLUT(size);
  for (let i = 0; i < base.data.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = base.data[i + c];
      base.data[i + c] = Math.max(0, Math.min(1, (v - 0.5) * 1.5 + 0.5));
    }
  }
  return { ...base, title: 'High Contrast' };
}

export const PRESET_LUTS = [
  generateWarmLUT,
  generateCoolLUT,
  generateVintageLUT,
  generateBWLUT,
  generateHighContrastLUT,
];
