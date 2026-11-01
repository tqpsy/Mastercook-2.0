import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/Mastercook-2.0/',
  // PGlite carica da sé i suoi file (wasm e dati): Vite non deve preimpacchettarlo.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  worker: { format: 'es' },
  // Data della versione, mostrata in Impostazioni accanto a «Aggiorna l’app».
  define: { __COSTRUITA_IL__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    VitePWA({
      // L'app nuova si attiva da sola alla riapertura; il blocco di versione del server impedisce
      // comunque a una versione vecchia di scrivere.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'icona.svg'],
      manifest: {
        name: 'Mastercook',
        short_name: 'Mastercook',
        description: 'Pasti, spesa, casa e scadenze della famiglia',
        lang: 'it',
        // Colore della barra di sistema in basso su Android (app installata): antracite come la barra delle schede.
        theme_color: '#2b2c2e',
        background_color: '#2b2c2e',
        display: 'standalone',
        start_url: '/Mastercook-2.0/',
        scope: '/Mastercook-2.0/',
        icons: [
          { src: 'icona-192.png?v=2', sizes: '192x192', type: 'image/png' },
          { src: 'icona-512.png?v=2', sizes: '512x512', type: 'image/png' },
          { src: 'icona-maschera-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Il database delle famiglie tenute sul telefono (PGlite, circa 17 MB): non si scarica in anticipo per tutti,
        // ma la prima volta che serve resta in cache, così poi funziona anche senza rete.
        // I caratteri (Outfit e Figtree) stanno nell'app: niente richieste a Google, e funzionano anche senza rete.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,woff2}'],
        globIgnores: ['**/anteprima-link.png', '**/pglite*', '**/initdb*', '**/motore.worker*'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/((pglite|initdb)[^/]*\.(wasm|data)|motore\.worker[^/]*\.js)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'mastercook-database-locale', expiration: { maxEntries: 6 } },
          },
        ],
      },
    }),
  ],
});
