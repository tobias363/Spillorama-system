import { defineConfig } from "vite";
import { resolve } from "node:path";

// 2026-05-01 (Tobias): admin-web kan kjøre lokalt mot to forskjellige backend-mål:
//
//   1) Lokal backend  (default — krever at apps/backend kjører på port 3000):
//      VITE_DEV_BACKEND_URL=http://localhost:3000  (eller la være å sette)
//
//   2) Live prod-backend (Render):
//      VITE_DEV_BACKEND_URL=https://spillorama-system.onrender.com
//
// CORS er ikke et problem — Vite proxyer requests via dev-server-en sin egen
// origin (localhost:5174), så browseren ser samme-origin-kall.
//
// `secure: false` lar oss bruke HTTPS-prod uten å bry oss om sertifikat-
// validering i dev (Render-sertifikatene er gyldige uansett — flagget er
// bare en safety-net for når operatører tester mot ikke-trustede staging-URLs).
const BACKEND_URL = process.env.VITE_DEV_BACKEND_URL ?? "http://localhost:3000";
const isHttps = BACKEND_URL.startsWith("https://");
const wsUrl = isHttps
  ? BACKEND_URL.replace(/^https:/, "wss:")
  : BACKEND_URL.replace(/^http:/, "ws:");

// CSP-en må whiteliste backend-targetet i `connect-src` så fetch + WS
// fungerer fra dev-serveren. Vi inkluderer både det aktive målet og
// localhost:3000 så switching mellom lokal/prod ikke krever CSP-endring.
const cspConnectSrc = [
  "'self'",
  "ws:",
  "wss:",
  "http://localhost:3000",
  ...(isHttps ? [BACKEND_URL] : []),
  "https://*.bankid.no",
  "https://*.bankid.com",
].join(" ");

export default defineConfig({
  root: __dirname,
  base: "/admin/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    // CSP in dev: allows BankID iframe-embed for future creds (BIN-631).
    // Production must mirror this via Render config or reverse-proxy headers.
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; " +
        "frame-src 'self' https://*.bankid.no https://*.bankid.com; " +
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
        "font-src 'self' data: https://fonts.gstatic.com; " +
        "img-src 'self' data: https:; " +
        `connect-src ${cspConnectSrc};`,
    },
    proxy: {
      "/api": {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
      },
      "/socket.io": {
        target: wsUrl,
        ws: true,
        changeOrigin: true,
        secure: false,
      },
      // Også asset-paths som backend serverer (TV voice-pakker, public-files):
      "/tv-voices": {
        target: BACKEND_URL,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
