import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIncomingAppUrl, registerMobileLaunchRouting } from "./mobileLaunchRouting.js";

test("normalizeIncomingAppUrl normalizes custom-scheme auth callback routes into router paths", () => {
  const normalized = normalizeIncomingAppUrl("convict://auth/login?code=abc&oauthProvider=google", {
    enabled: true,
    auth: {
      customScheme: "convict"
    }
  });

  assert.equal(normalized, "/auth/login?code=abc&oauthProvider=google");
});

test("normalizeIncomingAppUrl normalizes custom-scheme workspace routes", () => {
  const normalized = normalizeIncomingAppUrl("convict://w/acme/workouts/2026-05-07?tab=today", {
    enabled: true,
    auth: {
      customScheme: "convict"
    }
  });

  assert.equal(normalized, "/w/acme/workouts/2026-05-07?tab=today");
});

test("normalizeIncomingAppUrl normalizes allowed HTTPS app links", () => {
  const normalized = normalizeIncomingAppUrl("https://app.example.com/auth/login?code=abc", {
    enabled: true,
    auth: {
      appLinkDomains: ["app.example.com"]
    }
  });

  assert.equal(normalized, "/auth/login?code=abc");
});

test("normalizeIncomingAppUrl accepts same-origin HTTP URLs when explicitly allowed", () => {
  const normalized = normalizeIncomingAppUrl(
    "http://192.168.1.10:5173/w/acme",
    {
      enabled: true
    },
    {
      allowedHttpOrigins: ["http://192.168.1.10:5173"]
    }
  );

  assert.equal(normalized, "/w/acme");
});

test("normalizeIncomingAppUrl rejects unowned schemes and domains", () => {
  assert.equal(
    normalizeIncomingAppUrl("otherapp://auth/login?code=abc", {
      enabled: true,
      auth: {
        customScheme: "convict"
      }
    }),
    ""
  );

  assert.equal(
    normalizeIncomingAppUrl("https://evil.example.com/auth/login?code=abc", {
      enabled: true,
      auth: {
        appLinkDomains: ["app.example.com"]
      }
    }),
    ""
  );
});

test("registerMobileLaunchRouting initializes and applies the initial launch URL", async () => {
  const replaceCalls = [];
  const runtime = registerMobileLaunchRouting({
    router: {
      currentRoute: {
        value: {
          fullPath: "/home"
        }
      },
      async replace(target) {
        replaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: true,
      auth: {
        customScheme: "convict"
      }
    },
    getInitialLaunchUrl: async () => "convict://auth/login?code=abc"
  });

  const targetPath = await runtime.initialize();

  assert.equal(targetPath, "/auth/login?code=abc");
  assert.deepEqual(replaceCalls, ["/auth/login?code=abc"]);
});

test("registerMobileLaunchRouting subscribes to later launch URLs and routes them", async () => {
  const replaceCalls = [];
  let listener = null;
  const runtime = registerMobileLaunchRouting({
    router: {
      currentRoute: {
        value: {
          fullPath: "/home"
        }
      },
      async replace(target) {
        replaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: true,
      auth: {
        customScheme: "convict"
      }
    },
    subscribeToLaunchUrls(handler) {
      listener = handler;
      return () => {
        listener = null;
      };
    }
  });

  assert.equal(typeof listener, "function");
  listener("convict://w/acme");
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(replaceCalls, ["/w/acme"]);

  runtime.dispose();
  assert.equal(listener, null);
});

test("registerMobileLaunchRouting lets a resolver override the final route target", async () => {
  const replaceCalls = [];
  const runtime = registerMobileLaunchRouting({
    router: {
      currentRoute: {
        value: {
          fullPath: "/home"
        }
      },
      async replace(target) {
        replaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: true,
      auth: {
        customScheme: "convict"
      }
    },
    getInitialLaunchUrl: async () => "convict://auth/login?code=abc",
    resolveTargetPath({ originalUrl, normalizedTargetPath, reason }) {
      assert.equal(originalUrl, "convict://auth/login?code=abc");
      assert.equal(normalizedTargetPath, "/auth/login?code=abc");
      assert.equal(reason, "initial-launch");
      return "/w/acme";
    }
  });

  const targetPath = await runtime.initialize();

  assert.equal(targetPath, "/w/acme");
  assert.deepEqual(replaceCalls, ["/w/acme"]);
});

test("registerMobileLaunchRouting forwards unknown deep-link paths to the normal router", async () => {
  const replaceCalls = [];
  const runtime = registerMobileLaunchRouting({
    router: {
      currentRoute: {
        value: {
          fullPath: "/home"
        }
      },
      async replace(target) {
        replaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: true,
      auth: {
        customScheme: "convict"
      }
    },
    getInitialLaunchUrl: async () => "convict://w/acme/does-not-exist"
  });

  const targetPath = await runtime.initialize();

  assert.equal(targetPath, "/w/acme/does-not-exist");
  assert.deepEqual(replaceCalls, ["/w/acme/does-not-exist"]);
});

test("registerMobileLaunchRouting no-ops when mobile config is disabled", async () => {
  const replaceCalls = [];
  const runtime = registerMobileLaunchRouting({
    router: {
      currentRoute: {
        value: {
          fullPath: "/home"
        }
      },
      async replace(target) {
        replaceCalls.push(target);
      }
    },
    mobileConfig: {
      enabled: false,
      auth: {
        customScheme: "convict"
      }
    },
    getInitialLaunchUrl: async () => "convict://auth/login?code=abc",
    subscribeToLaunchUrls() {
      throw new Error("subscribeToLaunchUrls should not be called when mobile is disabled");
    }
  });

  const targetPath = await runtime.initialize();
  assert.equal(targetPath, "");
  assert.deepEqual(replaceCalls, []);
});
