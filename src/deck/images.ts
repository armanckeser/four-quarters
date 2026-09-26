/**
 * Turning a photo off someone's phone into something that fits in a deck file.
 *
 * The whole point of the deck format is that it travels by whatever channel the
 * sender already uses — AirDrop, a chat attachment, mail — so its size is a
 * feature, not an afterthought. A modern phone photo is 3-6 MB; six of those is
 * not a thing you send. Measured against the print set in this repo, 384px wide
 * at WebP q55 averages 16 KB a card, so a six-card deck lands near 100 KB.
 *
 * 384px is not arbitrary either: the print is rendered on a card roughly 9 cm
 * tall that spends most of its life mid-flight or in a thumbnail grid. Above
 * that width the extra pixels cost bytes and buy nothing visible.
 */

/** Long edge, in pixels, of the stored artwork. See the note above. */
const MAX_EDGE = 384;

const WEBP_QUALITY = 0.55;
/** Only reached if the browser cannot encode WebP; JPEG needs more bits for the same look. */
const JPEG_QUALITY = 0.72;

export type PreparedImage = {
  blob: Blob;
  width: number;
  height: number;
};

/**
 * Decoded through createImageBitmap where available: it decodes off the main
 * thread, so importing a dozen photos does not lock the machine mid-animation.
 * The <img> path is the fallback for browsers without it (and for SVG, which
 * some engines refuse to rasterise through createImageBitmap).
 */
async function decode(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, w: bitmap.width, h: bitmap.height };
    } catch {
      // fall through to the <img> path
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = url;
    });
    return { source: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    // Safe immediately: the decode above has already finished by the time we get here.
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Downscale to fit MAX_EDGE (never upscale — enlarging a small image only adds
 * bytes) and re-encode. Returns the stored form plus its pixel dimensions, which
 * the caller keeps so orientation never has to be re-derived by decoding again.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const { source, w, h } = await decode(file);
  if (!w || !h) throw new Error('That image reported no dimensions.');

  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const width = Math.max(1, Math.round(w * scale));
  const height = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser would not give us a 2D canvas.');
  // Photographs, so smoothing is what we want; the default is already 'low' in
  // some engines and the difference is visible at this much downscaling.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  if ('close' in source && typeof source.close === 'function') source.close();

  const webp = await encode(canvas, 'image/webp', WEBP_QUALITY);
  // A browser that cannot encode WebP silently hands back a PNG, which would be
  // several times larger than the JPEG we actually want — so check the type it
  // gave us rather than trusting that toBlob honoured the request.
  if (webp && webp.type === 'image/webp') return { blob: webp, width, height };

  const jpeg = await encode(canvas, 'image/jpeg', JPEG_QUALITY);
  if (jpeg) return { blob: jpeg, width, height };

  throw new Error('This browser could not re-encode that image.');
}

/** Wider than tall reads as landscape; the renderer's own guess uses the same rule. */
export function orientationOf(width: number, height: number): 'portrait' | 'landscape' {
  return width > height ? 'landscape' : 'portrait';
}
