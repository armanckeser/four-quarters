import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The link preview a chat app draws when someone sends a machine.
 *
 * These tags need absolute URLs, and only the deployment knows its own address,
 * so the Pages workflow passes it in as QUARTERS_SITE_URL. Without it (dev, a
 * local build) nothing is added, rather than shipping a preview that points at
 * somebody else's host. The title and description are read back out of
 * index.html so the page and its preview cannot drift apart.
 *
 * An invite is `#open?note=…`: crawlers drop the fragment and fetch this same
 * page, so every sent link gets this one card and the note stays in the browser.
 */
function sharePreview(siteUrl: string | undefined): Plugin {
  return {
    name: 'four-quarters-share-preview',
    transformIndexHtml(html, ctx) {
      if (!siteUrl || !ctx.path.endsWith('index.html')) return;
      const site = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
      const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
      const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
      if (!title || !description) throw new Error('index.html needs a <title> and a meta description');
      const image = `${site}og.jpg`;
      const meta = (key: 'property' | 'name', id: string, content: string): HtmlTagDescriptor => ({
        tag: 'meta',
        attrs: { [key]: id, content },
        injectTo: 'head',
      });
      return [
        { tag: 'link', attrs: { rel: 'canonical', href: site }, injectTo: 'head' },
        meta('property', 'og:type', 'website'),
        meta('property', 'og:site_name', 'Four Quarters'),
        meta('property', 'og:title', title),
        meta('property', 'og:description', description),
        meta('property', 'og:url', site),
        meta('property', 'og:image', image),
        meta('property', 'og:image:width', '1200'),
        meta('property', 'og:image:height', '600'),
        meta('property', 'og:image:alt', 'Four Quarters: a red mini print vending machine in a bookstore, with a birthday card sliding out'),
        meta('name', 'twitter:card', 'summary_large_image'),
        meta('name', 'twitter:title', title),
        meta('name', 'twitter:description', description),
        meta('name', 'twitter:image', image),
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), sharePreview(process.env.QUARTERS_SITE_URL)],
  // GitHub Pages serves a project site from /<repo>/, not the domain root. The
  // workflow sets this; everything that reaches into public/ goes through
  // lib/assets.ts so it follows.
  base: process.env.QUARTERS_BASE ?? '/',
  // Force a single copy of three (and React) so every package's `instanceof` checks
  // run against the same classes drei uses; duplicate copies ("Multiple instances of
  // Three.js") break them silently.
  resolve: {
    dedupe: ['three', 'react', 'react-dom'],
  },
});
