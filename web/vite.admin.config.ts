import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/**
 * The admin site: a second build of the same source, deployed to its own
 * Cloudflare Pages project (`autohiretech-admin`).
 *
 * Not a second codebase. It resolves `@/` exactly like the marketplace build,
 * so there is one copy of the data layer, the UI kit and the design tokens —
 * only the entry point (`admin.html` → `src/admin-main.tsx`), the static files
 * (`public-admin/`, which has no service worker or app manifest) and the output
 * directory differ. `build:admin` renames the emitted `admin.html` to
 * `index.html` so Pages serves it at `/`.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@autohire/shared': path.resolve(__dirname, '../packages/shared/src/index.ts'),
    },
  },
  publicDir: 'public-admin',
  build: {
    outDir: 'dist-admin',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'admin.html'),
    },
  },
});
