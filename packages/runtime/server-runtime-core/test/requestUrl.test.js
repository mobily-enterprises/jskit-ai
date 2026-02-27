import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLoginRedirectPathFromRequest,
  resolveClientIpAddress,
  safePathnameFromRequest,
  safeRequestUrl
} from "../src/shared/requestUrl.js";

test("safeRequestUrl parses valid and malformed request URLs", () => {
  const valid = safeRequestUrl({ raw: { url: "/api/history?page=2" } });
  assert.equal(valid.pathname, "/api/history");

  const fallbackFromMalformed = safeRequestUrl({ raw: { url: "http://%" } });
  assert.equal(fallbackFromMalformed.pathname, "/");

  const fallbackFromMissing = safeRequestUrl({});
  assert.equal(fallbackFromMissing.pathname, "/");
  assert.equal(safePathnameFromRequest({ url: "/console" }), "/console");
});

test("resolveClientIpAddress prioritizes x-forwarded-for first hop", () => {
  const request = {
    headers: {
      "x-forwarded-for": " 203.0.113.10 , 10.0.0.1"
    },
    ip: "198.51.100.2",
    socket: { remoteAddress: "192.0.2.5" }
  };

  assert.equal(resolveClientIpAddress(request), "203.0.113.10");
});

test("resolveClientIpAddress falls back to request ip, socket, then unknown", () => {
  assert.equal(resolveClientIpAddress({ ip: "198.51.100.2" }), "198.51.100.2");
  assert.equal(resolveClientIpAddress({ socket: { remoteAddress: "192.0.2.5" } }), "192.0.2.5");
  assert.equal(resolveClientIpAddress({}), "unknown");
});

test("buildLoginRedirectPathFromRequest appends sanitized returnTo for protected paths", () => {
  assert.equal(
    buildLoginRedirectPathFromRequest({
      request: { raw: { url: "/w/acme/choice-2?tab=summary" } },
      loginPath: "/login"
    }),
    "/login?returnTo=%2Fw%2Facme%2Fchoice-2%3Ftab%3Dsummary"
  );

  assert.equal(
    buildLoginRedirectPathFromRequest({
      request: { raw: { url: "/admin/w/acme/projects" } },
      loginPath: "/admin/login"
    }),
    "/admin/login?returnTo=%2Fadmin%2Fw%2Facme%2Fprojects"
  );
});

test("buildLoginRedirectPathFromRequest does not append returnTo for public auth paths", () => {
  assert.equal(
    buildLoginRedirectPathFromRequest({
      request: { raw: { url: "/login?returnTo=%2Fw%2Facme" } },
      loginPath: "/login",
      isPublicPath: (pathname) => pathname === "/login" || pathname === "/reset-password"
    }),
    "/login"
  );

  assert.equal(
    buildLoginRedirectPathFromRequest({
      request: { raw: { url: "/console/reset-password" } },
      loginPath: "/console/login",
      isPublicPath: (pathname) => pathname === "/console/login" || pathname === "/console/reset-password"
    }),
    "/console/login"
  );
});

test("buildLoginRedirectPathFromRequest rejects external returnTo from custom normalizer", () => {
  const denyAll = (_value, { fallback = "" } = {}) => fallback;

  assert.equal(
    buildLoginRedirectPathFromRequest({
      request: { raw: { url: "/w/acme" } },
      loginPath: "/login",
      normalizeReturnToPath: denyAll
    }),
    "/login"
  );
});
