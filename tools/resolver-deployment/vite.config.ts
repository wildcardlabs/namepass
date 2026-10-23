import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 5179,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    // The activation check reads the hosted application's public name record. The gateway itself
    // answers CORS, so the CCIP-Read request goes to it directly.
    proxy: { "/api/names": { target: "https://beta.namepass.com", changeOrigin: true, secure: true } },
  },
  build: {
    outDir: "/private/tmp/namepass-resolver-deployment-build",
    emptyOutDir: true,
  },
});
