import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "electron/main.ts"),
          "agent-worker": resolve(__dirname, "electron/agent-worker.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "electron/preload.ts"),
        output: { format: "cjs", entryFileNames: "preload.js" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "electron/renderer"),
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, "electron/renderer/index.html") } },
  },
});
