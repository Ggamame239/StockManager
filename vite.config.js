import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = new URL(env.VITE_APPS_SCRIPT_URL)

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'P.tech Stock Manager',
          short_name: 'P.tech Stock',
          description: 'ระบบจัดการสต็อคสินค้าสำหรับ P.tech interprecision',
          theme_color: '#173f5f',
          background_color: '#f6f3ed',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
      }),
    ],
    server: {
      proxy: {
        '/apps-script-api': {
          target: apiUrl.origin,
          changeOrigin: true,
          rewrite: () => apiUrl.pathname + apiUrl.search,
        },
      },
    },
  }
})
