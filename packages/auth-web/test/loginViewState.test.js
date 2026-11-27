import assert from "node:assert/strict";
import test from "node:test";
import { ref } from "vue";
import { useLoginViewState } from "../src/client/composables/loginView/useLoginViewState.js";

// The sign-in page's state for the address `search`, with no surfaces placed.
function stateAt(t, search, options = {}) {
  const originalWindow = globalThis.window;
  globalThis.window = { location: { href: `https://example.com/auth/login${search}`, origin: "https://example.com", search } };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  return useLoginViewState({ placementContext: ref(null), ...options });
}

test("a sign-in with no usable returnTo lands where the app names, and on / when it names nothing and places no surface", (t) => {
  assert.equal(stateAt(t, "").requestedReturnTo.value, "/");
  for (const search of ["", "?returnTo=https://elsewhere.example/steal", "?returnTo=/auth/login", "?returnTo=/auth/signout"]) {
    assert.equal(stateAt(t, search, { fallbackReturnTo: "/account" }).requestedReturnTo.value, "/account", search);
  }
  assert.equal(
    stateAt(t, "?returnTo=/console/projects", { fallbackReturnTo: "/account" }).requestedReturnTo.value,
    "/console/projects"
  );
});

// An app whose web root is its public website, served beside it, and whose own screens start at its default surface.
const WEBSITE_AT_ROOT = Object.freeze({
  surfaceConfig: {
    defaultSurfaceId: "home",
    enabledSurfaceIds: ["home", "auth"],
    surfacesById: {
      home: { id: "home", enabled: true, pagesRoot: "home", routeBase: "/home" },
      auth: { id: "auth", enabled: true, pagesRoot: "auth", routeBase: "/auth" }
    }
  }
});

test("a sign-in with no usable returnTo, as after a sign-out, lands on the app's default surface, not on a website at /", (t) => {
  for (const search of ["", "?returnTo=https://elsewhere.example/steal", "?returnTo=/auth/login", "?returnTo=/auth/signout"]) {
    const state = stateAt(t, search, { placementContext: ref(WEBSITE_AT_ROOT) });
    assert.equal(state.requestedReturnTo.value, "/home", search);
    assert.equal(state.mainScreenPath.value, "/home", search);
  }
  assert.equal(stateAt(t, "?returnTo=/home/orders", { placementContext: ref(WEBSITE_AT_ROOT) }).requestedReturnTo.value, "/home/orders");
  assert.equal(stateAt(t, "", { placementContext: ref(WEBSITE_AT_ROOT), fallbackReturnTo: "/account" }).requestedReturnTo.value,
    "/account");
});

test("a browser the shell found signed in is shown no form, unless it opened a confirmation link or a callback", (t) => {
  assert.equal(stateAt(t, "?returnTo=/home").redirectingSignedIn.value, false);
  assert.equal(stateAt(t, "?returnTo=/home", { signedIn: true }).redirectingSignedIn.value, true);
  assert.equal(stateAt(t, "?confirmation_token=abc", { signedIn: true }).redirectingSignedIn.value, false);
  assert.equal(stateAt(t, "?code=abc&state=xyz&provider=google", { signedIn: true }).redirectingSignedIn.value, false);
});
