import { useEffect, useState } from 'react';
import { CanvasTexture, LinearFilter, SRGBColorSpace, Texture } from 'three';

/** Portrait vs landscape, detected from an image's natural pixel dimensions. */
export type Orientation = 'portrait' | 'landscape';

/** Wider-than-tall reads as landscape; everything else (incl. square) as portrait. */
function orientationOf(image: HTMLImageElement): Orientation {
  return image.naturalWidth > image.naturalHeight ? 'landscape' : 'portrait';
}

/**
 * Loads an image URL and returns two textures: the crisp original and a blurred
 * copy (for locked/mystery thumbnails), plus the image's detected orientation. Blur
 * is done with the canvas 2D filter, which is reliable for raster and SVG sources
 * alike — unlike html-to-image, which mangles SVGs.
 */
export function usePrintTextures(url: string) {
  const [textures, setTextures] = useState<{
    crisp: Texture | null;
    blurred: Texture | null;
    orientation: Orientation | null;
  }>({ crisp: null, blurred: null, orientation: null });

  useEffect(() => {
    let cancelled = false;
    const created: CanvasTexture[] = [];

    // Draw at `drawSize`, then store in a `canvasSize` canvas. A small drawSize
    // relies on GPU linear filtering to upscale into a soft blur — reliable and
    // synchronous, unlike ctx.filter='blur()' on SVG sources (which can capture
    // a blank canvas because the filtered raster commits asynchronously).
    const makeTexture = (image: HTMLImageElement, drawSize: number, desaturate: boolean) => {
      const canvas = document.createElement('canvas');
      canvas.width = drawSize;
      canvas.height = drawSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (desaturate) ctx.filter = 'saturate(0.65) brightness(1.05)';
      // CONTAIN the image in the square slot (letterbox), never stretch it: a portrait
      // photo would otherwise be squished to 1:1. Fill with white first so the unused
      // band reads as paper margin, then draw the whole image centered at its true
      // aspect (min-scale fits the longer edge to the slot). The grid slot itself stays
      // square (MachineScene), so this is the only place the aspect must be honoured.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, drawSize, drawSize);
      const scale = Math.min(drawSize / image.naturalWidth, drawSize / image.naturalHeight);
      const drawWidth = image.naturalWidth * scale;
      const drawHeight = image.naturalHeight * scale;
      ctx.drawImage(
        image,
        (drawSize - drawWidth) / 2,
        (drawSize - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.needsUpdate = true;
      created.push(texture);
      return texture;
    };

    const image = new Image();
    image.src = url;
    // Ensure the bitmap is fully decoded before drawing — drawing an SVG that is
    // loaded-but-not-decoded yields a blank canvas (the cause of white thumbs).
    image
      .decode()
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        const crisp = makeTexture(image, 512, false);
        // A tiny source upscaled by GPU linear filtering reads as a heavy
        // mystery blur — only color blobs survive, no legible detail.
        const blurred = makeTexture(image, 10, true);
        setTextures({ crisp, blurred, orientation: orientationOf(image) });
      });

    return () => {
      cancelled = true;
      // Defer disposal so a StrictMode remount can reuse-or-replace cleanly; the
      // GPU keeps these tiny canvases alive until the next mount overwrites them.
      for (const texture of created) texture.dispose();
    };
  }, [url]);

  return textures;
}

/**
 * Loads a single crisp texture from an image URL (for the open card photo) and reports
 * the image's detected orientation AND true aspect ratio (naturalWidth / naturalHeight).
 * All three resolve together on image load, so the open card sizes its photo plane to the
 * image's real shape — never stretched — as soon as the photo appears.
 */
export function usePhotoTexture(url: string) {
  const [state, setState] = useState<{
    texture: Texture | null;
    orientation: Orientation | null;
    /** naturalWidth / naturalHeight of the loaded image; null until it loads. The open
     *  card sizes its photo plane to this so the photo is shown at its true aspect. */
    aspect: number | null;
  }>({ texture: null, orientation: null, aspect: null });

  useEffect(() => {
    let cancelled = false;
    let made: CanvasTexture | null = null;

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (cancelled) return;
      // Draw the texture at the image's REAL aspect (long edge = 1024), not a square:
      // the photo plane (FoldedCardPart) carries the aspect, so the texture must not
      // pre-stretch the pixels into a square — that was a second, compounding squish.
      const longEdge = 1024;
      const imageAspect = image.naturalWidth / image.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = imageAspect >= 1 ? longEdge : Math.round(longEdge * imageAspect);
      canvas.height = imageAspect >= 1 ? Math.round(longEdge / imageAspect) : longEdge;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      made = new CanvasTexture(canvas);
      made.colorSpace = SRGBColorSpace;
      setState({ texture: made, orientation: orientationOf(image), aspect: imageAspect });
    };
    image.src = url;

    return () => {
      cancelled = true;
      made?.dispose();
    };
  }, [url]);

  return state;
}
