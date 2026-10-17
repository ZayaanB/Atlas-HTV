import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Explicit offline launch; ordinary development/production default to the API.
  ...(mode === "fixture"
    ? {
        define: { "import.meta.env.VITE_DATA_MODE": JSON.stringify("fixture") },
      }
    : {}),
  server: {
    fs: {
      allow: [".", "../contracts", "../assets/evidence"].map((path) =>
        fileURLToPath(new URL(path, import.meta.url)),
      ),
    },
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    restoreMocks: true,
  },
}));
