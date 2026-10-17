import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
        // The hero's exam-demo island (v3 spec §2.7) — one vanilla-TS entry,
        // injected into dist/index.html from the manifest by
        // scripts/prerender.mjs. Not a page; no HTML entry of its own.
        island: resolve(__dirname, "src/island/exam-demo.ts"),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: false,
  },
});
