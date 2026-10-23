import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import docsPlugin from './vite-plugin-docs.ts';

export default defineConfig(({ mode }) => {
  const portable = mode === 'portable';
  // The repo-root VERSION file is the single version source (deploy-all.bat
  // and android\build.bat read it too). Baked into the client bundle so the
  // chooser footer can show the running version.
  const version = readFileSync(new URL('./VERSION', import.meta.url), 'utf8').trim();
  return {
    base: portable ? './' : '/',
    define: { __BW_VERSION__: JSON.stringify(version) },
    plugins: [docsPlugin()],
    build: {
      outDir: portable ? '网站' : 'dist',
      emptyOutDir: true,
      target: 'es2020',
      assetsInlineLimit: 0,
      modulePreload: !portable,
      cssCodeSplit: !portable,
      rollupOptions: portable
        ? {
            output: {
              codeSplitting: false,
              entryFileNames: 'app.js',
            },
          }
        : undefined,
    },
    test: {
      environment: 'jsdom',
      include: ['test/**/*.test.ts'],
    },
  };
});
