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

test("a sign-in with no usable returnTo lands where the app names, and on / when it names nothing", (t) => {
  assert.equal(stateAt(t, "").requestedReturnTo.value, "/");
  for (const search of ["", "?returnTo=https://elsewhere.example/steal", "?returnTo=/auth/login", "?returnTo=/auth/signout"]) {
    assert.equal(stateAt(t, search, { fallbackReturnTo: "/account" }).requestedReturnTo.value, "/account", search);
  }
  assert.equal(
    stateAt(t, "?returnTo=/console/projects", { fallbackReturnTo: "/account" }).requestedReturnTo.value,
    "/console/projects"
  );
});

test("a browser the shell found signed in is shown no form, unless it opened a confirmation link or a callback", (t) => {
  assert.equal(stateAt(t, "?returnTo=/home").redirectingSignedIn.value, false);
  assert.equal(stateAt(t, "?returnTo=/home", { signedIn: true }).redirectingSignedIn.value, true);
  assert.equal(stateAt(t, "?confirmation_token=abc", { signedIn: true }).redirectingSignedIn.value, false);
  assert.equal(stateAt(t, "?code=abc&state=xyz&provider=google", { signedIn: true }).redirectingSignedIn.value, false);
});
