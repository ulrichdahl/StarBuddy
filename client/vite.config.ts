import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// EXPERIMENT: Preact in place of React. Tests whether preact/compat makes the
// bundle, and each overlay webview's memory, smaller. Switch it on for one
// build with `STARBUDDY_PREACT=1 npm run build` (or `STARBUDDY_PREACT=1 npx
// tauri build`); unset, the build is plain React. It applies to the whole
// bundle, main window included: every window loads the same index.html and
// main.tsx, so there is no per-window seam to alias at. Meant for `vite build`
// only; dev-server Fast Refresh is React's and is not expected to work.
// See EXPERIMENTS.md. Remove this block, the `resolve` line below and the
// `preact` devDependency to end the experiment.
// @ts-expect-error process is a nodejs global
const preact = process.env.STARBUDDY_PREACT === "1";
const preactAliases = [
  { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
  { find: /^react-dom$/, replacement: "preact/compat" },
  { find: /^react\/jsx-runtime$/, replacement: "preact/jsx-runtime" },
  { find: /^react\/jsx-dev-runtime$/, replacement: "preact/jsx-dev-runtime" },
  { find: /^react$/, replacement: "preact/compat" },
];

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  // EXPERIMENT: see `preact` above.
  resolve: preact ? { alias: preactAliases } : {},

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
