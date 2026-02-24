import assert from "node:assert/strict";
import test from "node:test";
import { resolveClientIpAddress, safePathnameFromRequest, safeRequestUrl } from "../src/requestUrl.js";

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
