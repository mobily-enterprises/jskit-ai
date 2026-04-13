import assert from "node:assert/strict";
import test from "node:test";
import { appendAccountReturnToIfNeeded } from "../src/client/lib/profileMenuLinkTarget.js";

test("appendAccountReturnToIfNeeded appends relative returnTo for same-origin account settings targets", () => {
  const context = {
    surfaceConfig: {
      defaultSurfaceId: "home",
      surfacesById: {
        home: { id: "home", routeBase: "/home", origin: "https://www.example.com" },
        account: { id: "account", routeBase: "/account", origin: "https://www.example.com" }
      }
    }
  };

  assert.equal(
    appendAccountReturnToIfNeeded("/account", {
      placementContext: context,
      currentFullPath: "/home/profile?tab=security"
    }),
    "/account?returnTo=%2Fhome%2Fprofile%3Ftab%3Dsecurity"
  );
});

test("appendAccountReturnToIfNeeded appends absolute returnTo for cross-origin account settings targets", () => {
  const context = {
    surfaceConfig: {
      defaultSurfaceId: "home",
      surfacesById: {
        home: { id: "home", routeBase: "/home", origin: "https://www.example.com" },
        account: { id: "account", routeBase: "/account", origin: "https://account.example.com" }
      }
    }
  };

  assert.equal(
    appendAccountReturnToIfNeeded("/account", {
      placementContext: context,
      currentFullPath: "/home/profile?tab=security",
      currentHref: "https://www.example.com/home/profile?tab=security"
    }),
    "/account?returnTo=https%3A%2F%2Fwww.example.com%2Fhome%2Fprofile%3Ftab%3Dsecurity"
  );
});

test("appendAccountReturnToIfNeeded leaves non-account targets unchanged", () => {
  const context = {
    surfaceConfig: {
      defaultSurfaceId: "home",
      surfacesById: {
        home: { id: "home", routeBase: "/home", origin: "https://www.example.com" },
        account: { id: "account", routeBase: "/account", origin: "https://www.example.com" }
      }
    }
  };

  assert.equal(
    appendAccountReturnToIfNeeded("/console/settings", {
      placementContext: context,
      currentFullPath: "/home/profile"
    }),
    "/console/settings"
  );
});
