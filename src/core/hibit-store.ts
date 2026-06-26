import type { HiBitImage } from '@/lib/png16';

/**
 * Box-average downscale of an RGBA-16 image. Used so the float pipeline runs at
 * display resolution (LOD) instead of full sensor resolution, mirroring the
 * 8-bit `getMemoisedScratchCanvas` path. Returns the source unchanged when the
 * target is ≥ the source on both axes.
 */
export function downscaleHiBit(src: HiBitImage, tw: number, th: number): HiBitImage {
  const { data: s, width: sw, height: sh } = src;
  if (tw >= sw && th >= sh) return src;
  const out = new Uint16Array(tw * th * 4);
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor((ty * sh) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * sh) / th));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor((tx * sw) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * sw) / tw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          r += s[i]; g += s[i + 1]; b += s[i + 2]; a += s[i + 3]; n++;
        }
      }
      const o = (ty * tw + tx) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { data: out, width: tw, height: th };
}

/**
 * Per-layer store of high-bit-depth (RGBA-16) source pixels, parallel to the
 * 8-bit `pixelStore`. Only RAW-16 layers register here; everything else (and
 * every existing reader) keeps using the 8-bit canvas. The WebGL pipeline is
 * the only consumer — it uploads this as a float source texture.
 */
class HiBitStore {
  private sources = new Map<string, HiBitImage>();
  private cache = new Map<string, HiBitImage>(); // `${layerId}:${w}x${h}` → downscaled

  register(layerId: string, img: HiBitImage): void {
    this.sources.set(layerId, img);
    this.dropCache(layerId);
  }

  get(layerId: string): HiBitImage | undefined {
    return this.sources.get(layerId);
  }

  has(layerId: string): boolean {
    return this.sources.has(layerId);
  }

  /** Source downscaled to `w×h` (memoised). Returns the full-res source when
   *  the target is ≥ it, or undefined when the layer has no hi-bit source. */
  getDownscaled(layerId: string, w: number, h: number): HiBitImage | undefined {
    const src = this.sources.get(layerId);
    if (!src) return undefined;
    if (w >= src.width && h >= src.height) return src;
    const key = `${layerId}:${w}x${h}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const down = downscaleHiBit(src, w, h);
    this.cache.set(key, down);
    return down;
  }

  remove(layerId: string): void {
    this.sources.delete(layerId);
    this.dropCache(layerId);
  }

  clear(): void {
    this.sources.clear();
    this.cache.clear();
  }

  private dropCache(layerId: string): void {
    const prefix = `${layerId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }
}

export const hiBitStore = new HiBitStore();
