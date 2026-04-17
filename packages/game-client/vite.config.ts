import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  base: "/web/games/",
  build: {
    outDir: path.resolve(__dirname, "../../apps/backend/public/web/games"),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/main.ts"),
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared-types/src"),
    },
  },
});
