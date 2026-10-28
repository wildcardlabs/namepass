import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import logoutRoute from "../routes/api/auth/logout";
import { COOKIE, githubCallback, githubLogin, monitoringSession } from "./monitoring-auth";

test("GitHub callback issues separate cookies and sessions reject tampering, expiry and removed users", async () => {
 const keys = ["MONITORING_GITHUB_CLIENT_ID", "MONITORING_GITHUB_CLIENT_SECRET", "MONITORING_SESSION_SECRET", "MONITORING_GITHUB_USERS"];
 const previous = keys.map(k => process.env[k]);
 const originalFetch = globalThis.fetch;
 try {
  process.env.MONITORING_GITHUB_CLIENT_ID = "test-client";
  process.env.MONITORING_GITHUB_CLIENT_SECRET = "test-client-secret";
  process.env.MONITORING_SESSION_SECRET = "a".repeat(32);
  process.env.MONITORING_GITHUB_USERS = "devone,devtwo";
  const login = githubLogin(new Request("https://example.com/api/auth/github"));
  const state = new URL(login.headers.get("location")!).searchParams.get("state")!;
  const stateCookie = login.headers.get("set-cookie")!.split(";")[0];
  let calls = 0;
  globalThis.fetch = async () => Response.json(++calls === 1 ? { access_token: "test-token" } : { login: "devone", id: 123 });
  await assert.rejects(githubCallback(new Request("https://example.com/api/auth/github/callback?code=x&state=wrong", { headers: { cookie: stateCookie } })), /expired/);
  assert.equal(calls, 0);
  const response = await githubCallback(new Request(`https://example.com/api/auth/github/callback?code=x&state=${state}`, { headers: { cookie: stateCookie } }));
  assert.equal(response.headers.getSetCookie().length, 2);
  const sessionCookie = response.headers.getSetCookie()[0].split(";")[0];
  const req = (cookie: string) => new Request("https://example.com/api/monitoring", { headers: { cookie } });
  assert.deepEqual(monitoringSession(req(sessionCookie)), { login: "devone" });
  assert.equal(monitoringSession(req(sessionCookie + "tampered")), null);
  for (const time of [Math.floor(Date.now() / 1000) - 43201, Math.floor(Date.now() / 1000) + 3600]) {
   const payload = `devone:123:${time}`;
   const signature: string = createHmac("sha256", "a".repeat(32)).update(payload).digest("base64url");
   assert.equal(monitoringSession(req(`${COOKIE}=${payload}.${signature}`)), null);
  }
  process.env.MONITORING_GITHUB_USERS = "devtwo,devthree";
  assert.equal(monitoringSession(req(sessionCookie)), null);
 } finally {
  globalThis.fetch = originalFetch;
  keys.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
 }
});

test("logout rejects unsupported methods and untrusted origins without changing cookies", async () => {
 for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
  const response = await logoutRoute.fetch(new Request("https://example.com/api/auth/logout", {
   method, headers: { origin: "https://example.com", cookie: `${COOKIE}=existing-session` },
  }));
  assert.equal(response.status, 405, method);
  assert.equal(response.headers.get("allow"), "POST", method);
  assert.equal(response.headers.get("set-cookie"), null, method);
 }
 for (const origin of [undefined, "null", "https://attacker.test", "https://other.example.com", "https://example.com.attacker.test", "http://example.com", "https://example.com:8443", "https://example.com/path", "invalid"]) {
  const response = await logoutRoute.fetch(new Request("https://example.com/api/auth/logout", {
   method: "POST", headers: { cookie: `${COOKIE}=existing-session`, ...(origin === undefined ? {} : { origin }) },
  }));
  assert.equal(response.status, 403, origin ?? "missing origin");
  assert.equal(response.headers.get("set-cookie"), null, origin ?? "missing origin");
 }
});

test("same-origin POST logout expires the session and redirects to monitoring with GET", async () => {
 for (const origin of ["https://example.com", "https://preview.example.com:8443"]) {
  const response = await logoutRoute.fetch(new Request(`${origin}/api/auth/logout`, {
   method: "POST", headers: { origin, cookie: `${COOKIE}=existing-session` },
  }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/monitoring");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.headers.getSetCookie(), [`${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`]);
 }
});
