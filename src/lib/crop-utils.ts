/**
 * Crop math utilities.
 */

/**
 * Compute the largest axis-aligned rectangle inscribed in a rotated rectangle.
 * Used for straighten: after rotating the image by `angleDeg`, the crop rect
 * auto-shrinks to the largest safe area that doesn't show canvas background.
 */
export function computeInscribedRect(
  imgW: number,
  imgH: number,
  angleDeg: number,
): { width: number; height: number } {
  const a = Math.abs(angleDeg * (Math.PI / 180));
  if (a < 1e-6) return { width: imgW, height: imgH };

  const sinA = Math.sin(a);
  const cosA = Math.cos(a);

  if (imgW <= 0 || imgH <= 0) return { width: 0, height: 0 };

  let w: number, h: number;
  if (sinA * cosA === 0) {
    w = imgW;
    h = imgH;
  } else {
    const w1 = imgW * cosA - imgH * sinA;
    const w2 = imgH * cosA - imgW * sinA;

    if (w1 > 0 && w2 > 0) {
      const numer = cosA * cosA - sinA * sinA;
      if (Math.abs(numer) > 1e-9) {
        w = (imgW * cosA - imgH * sinA) / numer;
        h = (imgH * cosA - imgW * sinA) / numer;
        if (w > imgW || h > imgH || w <= 0 || h <= 0) {
          const scale = Math.min(imgW / Math.abs(w), imgH / Math.abs(h));
          w = Math.abs(w) * scale;
          h = Math.abs(h) * scale;
        }
      } else {
        w = imgW;
        h = imgH;
      }
    } else {
      const scale = Math.min(
        imgW / (imgW * cosA + imgH * sinA),
        imgH / (imgW * sinA + imgH * cosA),
      );
      w = imgW * scale;
      h = imgH * scale;
    }
  }

  return { width: Math.max(0, w), height: Math.max(0, h) };
}
