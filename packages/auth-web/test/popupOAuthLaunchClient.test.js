import assert from "node:assert/strict";
import test from "node:test";
import {
  OAUTH_POPUP_BLOCKED_MESSAGE,
  OAUTH_POPUP_MESSAGE_TYPE,
  completeOAuthPopupSignIn,
  createPopupOAuthLaunchClient
} from "../src/client/runtime/popupOAuthLaunchClient.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function fakeWindow({ framed = false, popup = {}, storage = memoryStorage() } = {}) {
  const listeners = new Set();
  const win = {
    location: { origin: "https://app.example.test", reloaded: 0, reload() { this.reloaded += 1; } },
    localStorage: storage,
    opened: [],
    closed: false,
    open(url, name, features) {
      this.opened.push({ url, name, features });
      return popup;
    },
    close() {
      this.closed = true;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    dispatch: (event) => [...listeners].forEach((listener) => listener(event)),
    setTimeout: () => 1,
    clearTimeout() {},
    listenerCount: () => listeners.size
  };
  win.self = win;
  win.top = framed ? {} : win;
  return win;
}

test("an unframed page signs in by navigating, as before", async () => {
  const navigations = [];
  const win = fakeWindow();
  const client = createPopupOAuthLaunchClient({ window: win, fallback: { open: async ({ url }) => navigations.push(url) } });
  await client.open({ url: "/api/oauth/oidc/start" });
  assert.deepEqual(navigations, ["/api/oauth/oidc/start"]);
  assert.equal(win.opened.length, 0);
});

test("a framed page opens a sign-in window and reloads when it reports success", async () => {
  const win = fakeWindow({ framed: true });
  const client = createPopupOAuthLaunchClient({ window: win });
  const opening = client.open({ url: "/api/oauth/oidc/start?returnTo=%2F" });
  assert.equal(win.opened[0].url, "/api/oauth/oidc/start?returnTo=%2F");
  assert.equal(win.opened[0].name, "jskit-oauth-sign-in");
  assert.match(win.opened[0].features, /^popup=yes,width=520,height=680/u);

  win.dispatch({ origin: "https://attacker.example", data: { type: OAUTH_POPUP_MESSAGE_TYPE } });
  win.dispatch({ origin: "https://app.example.test", data: { type: "something-else" } });
  assert.equal(win.location.reloaded, 0, "only this origin's completion message counts");

  win.dispatch({ origin: "https://app.example.test", data: { type: OAUTH_POPUP_MESSAGE_TYPE } });
  assert.equal(await opening, true);
  assert.equal(win.location.reloaded, 1);
  assert.equal(win.listenerCount(), 0);
});

test("a blocked window says how to allow it", async () => {
  const win = fakeWindow({ framed: true, popup: null });
  await assert.rejects(createPopupOAuthLaunchClient({ window: win }).open({ url: "/start" }), { message: OAUTH_POPUP_BLOCKED_MESSAGE });
});

test("the callback window tells its opener and closes", () => {
  const messages = [];
  const opener = { closed: false, location: { origin: "https://app.example.test" }, postMessage: (message, origin) => messages.push({ message, origin }) };
  const popupWindow = { ...fakeWindow(), opener };
  assert.equal(completeOAuthPopupSignIn(popupWindow), true);
  assert.deepEqual(messages, [{ message: { type: OAUTH_POPUP_MESSAGE_TYPE }, origin: "https://app.example.test" }]);
  assert.equal(popupWindow.closed, true);
});

test("a callback in an ordinary tab is left alone", () => {
  const tab = fakeWindow();
  assert.equal(completeOAuthPopupSignIn(tab), false);
  assert.equal(tab.closed, false);
  const foreignOpener = { ...fakeWindow(), opener: { closed: false, location: { get origin() { throw new Error("cross-origin"); } } } };
  assert.equal(completeOAuthPopupSignIn(foreignOpener), false);
});

test("a window whose opener link was cut still finishes through the shared channel", () => {
  const storage = memoryStorage();
  const framed = fakeWindow({ framed: true, storage, popup: {} });
  createPopupOAuthLaunchClient({ window: framed }).open({ url: "/start" });
  const callback = fakeWindow({ storage });
  callback.opener = null;
  assert.equal(completeOAuthPopupSignIn(callback), true);
  assert.equal(callback.closed, true);
  assert.equal(storage.getItem("jskit.auth-web.oauth-popup.started-at"), null);
});
