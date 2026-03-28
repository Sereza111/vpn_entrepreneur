import { defineConfig } from "vite";

export default defineConfig({
  base: "/app/",
  root: ".",
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/telegram": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
});