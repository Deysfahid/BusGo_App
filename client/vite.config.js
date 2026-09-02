import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all interfaces so a phone on the same Wi-Fi can reach the dev
    // server at http://<laptop-lan-ip>:5173 for real-GPS testing.
    host: true,
    // Tunnel domains, so an https tunnel can be used for phone testing
    // (browsers only expose geolocation on https or localhost).
    allowedHosts: ['.trycloudflare.com', '.loca.lt', '.ngrok-free.app', '.ngrok.io'],
    // Proxy the backend through this same origin. A phone then only ever talks
    // to port 5173, so it needs no separate firewall exception for the JVM on
    // 8080, and there is no cross-origin request to configure.
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'http://localhost:8080', ws: true, changeOrigin: true },
    },
  },
  preview: {
    allowedHosts: ['busgo-frontend-sdyc.onrender.com'],
  },
})