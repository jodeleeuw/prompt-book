import { defineConfig } from 'vite';

// Deployed as a GitHub Pages project site at /prompt-book/.
// `host: true` so the dev server is reachable from the tablet over the LAN.
export default defineConfig({
  base: '/prompt-book/',
  server: { host: true },
});
