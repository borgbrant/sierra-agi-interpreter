import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so a build can be served from any path, not just the root.
  base: './',
  server: { port: 5173 },
  build: {
    target: 'es2022',
    outDir: 'dist',
    // The game files are already compact binaries; inlining them as data URIs
    // would only make the bundle harder to inspect.
    assetsInlineLimit: 0,
  },
});
