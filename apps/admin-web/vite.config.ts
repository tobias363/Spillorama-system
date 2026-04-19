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
    proxy: {
      "/api": "http://localhost:3000",
      "/socket.io": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
