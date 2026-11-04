import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// Ports de développement : 8080 et 5173 sont souvent pris sur la machine de l'utilisateur.
// Le serveur écoute sur 18080 (dev/start-instance.mjs) ; la redirection OIDC passe par Vite
// (UD_PUBLIC_URL=http://localhost:5290).
const api = 'http://127.0.0.1:18080';

export default defineConfig({
  // Le plugin du routeur doit précéder celui de React.
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    // Dans l'espace de travail, les paquets @ud/* sont lus depuis leurs sources.
    conditions: ['@ud/source', ...defaultClientConditions],
  },
  server: {
    port: 5290,
    strictPort: true,
    proxy: {
      '/api': api,
      '/mcp': api,
      '/healthz': api,
    },
  },
});
