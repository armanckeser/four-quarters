/**
 * Paths into `public/`, resolved against wherever the app is actually served.
 *
 * A leading-slash path assumes the app owns the domain root. GitHub Pages serves
 * a project site from `/<repo>/`, so `/sfx/coin-drop-1.mp3` becomes a 404 and the
 * machine goes silent, unlit (the HDRI) and falls back to system fonts — three
 * separate quiet failures that all look like "it just doesn't work here".
 *
 * `import.meta.env.BASE_URL` is whatever `base` was at build time and always ends
 * in a slash, so this is correct at the root and under a subpath both.
 */
export function asset(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}
