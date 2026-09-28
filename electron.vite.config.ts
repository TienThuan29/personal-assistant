import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: { rollupOptions: { external: ['node:sqlite'] } },
  },
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } } },
  },
  renderer: {
    resolve: { dedupe: ['react', 'react-dom', '@arco-design/web-react', '@icon-park/react'] },
  },
});
