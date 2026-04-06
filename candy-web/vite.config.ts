import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/candy/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4174,
    fs: {
      allow: [path.resolve(dirname, "..")],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4174,
  },
}));
