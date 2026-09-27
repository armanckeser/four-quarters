import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
