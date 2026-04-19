import { defineConfig } from "vite";
import { resolve } from "node:path";

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
        "connect-src 'self' ws: wss: http://localhost:3000 https://*.bankid.no https://*.bankid.com;",
    },
    proxy: {
      "/api": "http://localhost:3000",
      "/socket.io": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
