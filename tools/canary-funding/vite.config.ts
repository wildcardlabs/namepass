import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { writeJournal } from "../journal";

const port = 5178;
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [{ name: "canary-funding-record", configureServer(server) {
    // Mirrors the browser journal to a private local file so a closed tab loses nothing.
    server.middlewares.use("/funding-record", (request, response) => {
      if (request.method !== "POST" || ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin ?? "")) { response.statusCode = 403; response.end(); return; }
      let body = "";
      request.on("data", chunk => { body += chunk; if (body.length > 50000) request.destroy(); });
      request.on("end", () => {
        try { const data = JSON.parse(body); if (!Array.isArray(data.entries)) throw Error(); writeJournal("/private/tmp/namepass-canary-funding-journal.json", data); response.end("saved"); }
        catch { response.statusCode = 400; response.end(); }
      });
    });
  }}],
  server: { host: "127.0.0.1", port, strictPort: true,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    proxy: { "/api/names": { target: "https://beta.namepass.com", changeOrigin: true, secure: true } },
  },
  build: { outDir: "/private/tmp/namepass-canary-funding-build", emptyOutDir: true },
});
