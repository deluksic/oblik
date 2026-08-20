import { defineConfig } from "vite";
import { fsBridgePlugin } from "./vite-plugin-fs.ts";

export default defineConfig({
  plugins: [fsBridgePlugin()],
  server: {
    host: "127.0.0.1",
    port: 43117,
    strictPort: true,
  },
});
