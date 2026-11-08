import assert from "node:assert/strict";
import test from "node:test";

import { resolveTrustedProxies } from "./trustedProxies.js";

test("TRUSTED_PROXIES lists the proxies' addresses, ranges and range names; nothing set is loopback", () => {
  assert.deepEqual(resolveTrustedProxies({}), ["loopback"]);
  assert.deepEqual(resolveTrustedProxies({ TRUSTED_PROXIES: "  " }), ["loopback"]);
  assert.deepEqual(
    resolveTrustedProxies({ TRUSTED_PROXIES: "loopback, 10.0.0.5,192.168.10.0/24 , 172.16.0.0/255.240.0.0,fd00::/8,::1" }),
    ["loopback", "10.0.0.5", "192.168.10.0/24", "172.16.0.0/255.240.0.0", "fd00::/8", "::1"]
  );
  assert.deepEqual(resolveTrustedProxies({ TRUSTED_PROXIES: "uniquelocal,linklocal" }), ["uniquelocal", "linklocal"]);
});

test("TRUSTED_PROXIES refuses true and hop counts, which let any client choose its own address", () => {
  for (const setting of ["true", "TRUE", "loopback,true"]) {
    assert.throws(() => resolveTrustedProxies({ TRUSTED_PROXIES: setting }),
      /believes every request's X-Forwarded-For, so any client could choose its own address/u, setting);
  }
  for (const setting of ["1", "2", "10.0.0.5, 3"]) {
    assert.throws(() => resolveTrustedProxies({ TRUSTED_PROXIES: setting }), /is a hop count/u, setting);
  }
});

test("TRUSTED_PROXIES refuses anything that is not an address, a range or a range name", () => {
  for (const entry of ["proxy.example.com", "false", "10.0.0.0/33", "fd00::/129", "10.0.0.5/8/1", "Loopback", "::1/255.0.0.0"]) {
    assert.throws(() => resolveTrustedProxies({ TRUSTED_PROXIES: entry }),
      new RegExp(`has "${entry.replace(/[./]/gu, "\\$&")}", which is not an address`, "u"), entry);
  }
});
