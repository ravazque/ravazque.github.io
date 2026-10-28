import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("../server/internal/web/dist", import.meta.url));
const go = "http://localhost:8000";

export default defineConfig({
  plugins: [
    vue(),
    // the Go binary embeds this folder: it must exist (with this file) even before the first build
    { name: "keep-dist", closeBundle: () => writeFileSync(`${out}/.gitkeep`, "") },
  ],
  resolve: { alias: { "@data": fileURLToPath(new URL("../server/core/data", import.meta.url)) } },
  build: { outDir: out, emptyOutDir: true, assetsInlineLimit: 0 },
  server: {
    fs: { allow: [".."] },
    proxy: Object.fromEntries(["/api", "/auth", "/dev", "/avatar", "/ui.css", "/healthz"].map((p) => [p, go])),
  },
  test: { environment: "jsdom" },
});
