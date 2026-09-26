import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves a project site from /<repo>/, not the domain root. The
  // workflow sets this; everything that reaches into public/ goes through
  // lib/assets.ts so it follows.
  base: process.env.QUARTERS_BASE ?? '/',
  // Force a single copy of three + three-mesh-bvh so three-bvh-csg's instanceof
  // checks (and BVH's prototype patch) work against the same classes drei uses.
  // Without this, Vite can bundle duplicate copies ("Multiple instances of
  // Three.js"), which breaks CSG evaluation.
  resolve: {
    dedupe: ['three', 'three-mesh-bvh', 'react', 'react-dom'],
  },
});
