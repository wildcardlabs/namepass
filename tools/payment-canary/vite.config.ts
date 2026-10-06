import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [{ name: "capture-status", configureServer(server) {
    server.middlewares.use("/payment-record", (request, response) => {
      if (request.method !== "POST" || !["http://127.0.0.1:5175", "http://localhost:5175"].includes(request.headers.origin ?? "")) { response.statusCode = 403; response.end(); return; }
      let body = "";
      request.on("data", chunk => { body += chunk; if (body.length > 50000) request.destroy(); });
      request.on("end", () => {
        try { const data = JSON.parse(body); if (!Array.isArray(data.entries)) throw Error(); writeFileSync("/private/tmp/namepass-october-payment-journal.json", JSON.stringify(data, null, 2) + "\n", { mode: 0o600 }); response.end("saved"); }
        catch { response.statusCode = 400; response.end(); }
      });
    });
    server.middlewares.use("/capture-status", (_request, response) => {
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      try {
        const state = JSON.parse(readFileSync("/private/tmp/namepass-october-payment-capture-progress.json", "utf8"));
        response.end(JSON.stringify({ active: state.captureState === "receiving" && Date.parse(state.deadline) > Date.now(), startedAt: state.startedAt, deadline: state.deadline }));
      } catch { response.end(JSON.stringify({ active: false })); }
    });
  }}],
  server: { host: "127.0.0.1", port: 5175, strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    proxy: { "/api/names": { target: "https://beta.namepass.com", changeOrigin: true, secure: true } },
  },
  build: { outDir: "/private/tmp/namepass-payment-canary-build", emptyOutDir: true },
});
