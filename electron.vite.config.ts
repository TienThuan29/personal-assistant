import { defineConfig } from 'electron-vite';
import UnoCSS from 'unocss/vite';
import uno from './uno.config';

export default defineConfig({
  main: {
    build: { rollupOptions: { external: ['node:sqlite'] } },
  },
  preload: {
    // Sandboxed preloads must be CommonJS.
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } } },
  },
  renderer: {
    // The CSP in index.html allows no WebSocket; only the dev server needs one, for Vite's HMR client.
    plugins: [
      UnoCSS(uno),
      {
        name: 'csp-dev-hmr',
        apply: 'serve',
        transformIndexHtml: (html) => html.replace("connect-src 'self'", "connect-src 'self' ws://localhost:*"),
      },
    ],
    resolve: { dedupe: ['react', 'react-dom', '@arco-design/web-react', '@icon-park/react'] },
  },
});
