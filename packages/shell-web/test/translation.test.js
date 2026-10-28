import assert from "node:assert/strict";
import test from "node:test";
import { createI18n } from "vue-i18n";
import { setJskitI18n, useJskitText } from "@jskit-ai/kernel/client/i18n";
import { flattenCatalog } from "@jskit-ai/kernel/shared/i18n";
import en from "../locales/en.json" with { type: "json" };
import { createErrorRuntime } from "../src/client/error/runtime.js";
import { createErrorPresentationStore } from "../src/client/error/store.js";
import { createDefaultMaterialErrorPresenters } from "../src/client/error/presenters.js";
import { requestRecoveryMessage } from "../src/client/requestRecovery/runtime.js";
import { resolveShellDrawerToggleLabel } from "../src/client/support/drawerPresentation.js";

// A test language with every shell key translated, plus the kernel code used below.
function testLanguageMessages() {
  const messages = {};
  for (const [key, message] of Object.entries({
    ...flattenCatalog(en),
    "jskit.errors.not_found": "Not found."
  })) {
    let target = messages;
    const segments = key.split(".");
    for (const segment of segments.slice(0, -1)) {
      target = target[segment] ||= {};
    }
    target[segments.at(-1)] = `[xx] ${message}`;
  }
  return messages;
}

function withTestLanguage(run) {
  setJskitI18n(createI18n({ legacy: false, locale: "xx", messages: { xx: testLanguageMessages() } }));
  try {
    return run();
  } finally {
    setJskitI18n(null);
  }
}

function createStoreRuntime() {
  const store = createErrorPresentationStore();
  const runtime = createErrorRuntime({
    presenters: createDefaultMaterialErrorPresenters({ store }),
    moduleDefaultPresenterId: "material.snackbar"
  });
  return { store, runtime };
}

test("shell texts stay English without an app vue-i18n instance", () => {
  assert.equal(
    requestRecoveryMessage(null),
    "The app could not reach the server or network. Check the connection and try again."
  );
  assert.equal(resolveShellDrawerToggleLabel({ compact: true, open: false }), "Open navigation menu");
});

test("shell texts follow the app's active language", () => {
  withTestLanguage(() => {
    assert.equal(
      requestRecoveryMessage(null),
      "[xx] The app could not reach the server or network. Check the connection and try again."
    );
    assert.equal(
      requestRecoveryMessage(null, { label: "jskit.shell.recovery.appDataLabel" }),
      "[xx] [xx] App data could not reach the server or network. Check the connection and try again."
    );
    assert.equal(resolveShellDrawerToggleLabel({ compact: false, open: true }), "[xx] Collapse navigation drawer");
  });
});

test("presented errors keep their server code so the error host can translate them", () => {
  const { store, runtime } = createStoreRuntime();
  const serverError = Object.assign(new Error("Not found."), { status: 404, code: "not_found", params: {} });
  runtime.report({ cause: serverError, intent: "action-feedback" });
  runtime.report({ message: "Contact not found.", cause: Object.assign(new Error("Contact not found."), { code: "not_found" }) });

  const [generic, appSentence] = store.getState().channels.snackbar;
  assert.equal(generic.code, "not_found");
  assert.equal(generic.message, "Not found.");

  withTestLanguage(() => {
    const { serverMessage } = useJskitText();
    assert.equal(serverMessage(generic), "[xx] Not found.");
    assert.equal(serverMessage(appSentence), "Contact not found.");
  });
});

test("presented client errors keep their messageCode from the cause", () => {
  const { store, runtime } = createStoreRuntime();
  const uiError = Object.assign(new Error("Unexpected UI error."), {
    messageCode: "shell.error.unexpectedUi",
    messageParams: {}
  });
  runtime.report({ cause: uiError });

  const [entry] = store.getState().channels.snackbar;
  assert.equal(entry.messageCode, "shell.error.unexpectedUi");
  withTestLanguage(() => {
    assert.equal(useJskitText().serverMessage(entry), "[xx] Unexpected UI error.");
  });
});
