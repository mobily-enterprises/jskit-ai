import assert from "node:assert/strict";
import test from "node:test";
import { vPending } from "../src/client/directives/vPending.js";

// The browser behaviour (focus kept, Enter ignored, a marked field focused) is in pendingAction.browser.test.js; these
// check the directive's own steps on stand-in elements.

function createDocument() {
  return { activeElement: null };
}

function createField(document, { visible = true, disabled = false } = {}) {
  const field = {
    disabled,
    matches: () => true,
    getClientRects: () => (visible ? [{}] : []),
    focus() {
      document.activeElement = field;
    }
  };
  return field;
}

function createButton(document, { form = null, dialog = null } = {}) {
  const attributes = new Map();
  const listeners = [];
  const button = {
    ownerDocument: document,
    form,
    matches: () => true,
    querySelector: () => null,
    closest: () => dialog,
    contains: (other) => other === button,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name) ?? null,
    addEventListener: (type, handler, capture) => listeners.push({ type, handler, capture }),
    removeEventListener: (type, handler, capture) => {
      const index = listeners.findIndex((entry) => entry.type === type && entry.handler === handler && entry.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
    listeners,
    click() {
      const calls = [];
      const event = {
        currentTarget: button,
        preventDefault: () => calls.push("preventDefault"),
        stopImmediatePropagation: () => calls.push("stopImmediatePropagation")
      };
      for (const { handler } of listeners.filter((entry) => entry.type === "click")) handler(event);
      return calls;
    },
    focus() {
      document.activeElement = button;
    }
  };
  return button;
}

function scope(fields) {
  return { querySelectorAll: () => fields };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 5));

test("a pending button reads as unavailable and cancels its activation until it settles", () => {
  const document = createDocument();
  const button = createButton(document);
  vPending.mounted(button, { value: false });
  assert.deepEqual(button.listeners.map(({ type, capture }) => [type, capture]), [["click", true]]);
  assert.equal(button.getAttribute("aria-disabled"), null);
  assert.deepEqual(button.click(), [], "an idle button's click goes through");

  vPending.updated(button, { value: true, oldValue: false });
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.deepEqual(button.click(), ["preventDefault", "stopImmediatePropagation"]);

  vPending.updated(button, { value: false, oldValue: true });
  assert.equal(button.getAttribute("aria-disabled"), null);
  assert.deepEqual(button.click(), []);

  vPending.beforeUnmount(button);
  assert.equal(button.listeners.length, 0);
});

test("settling with focus on the button focuses the first visible, enabled field the refusal marked in its form", async () => {
  const document = createDocument();
  const hidden = createField(document, { visible: false });
  const disabled = createField(document, { disabled: true });
  const email = createField(document);
  const button = createButton(document, { form: scope([hidden, disabled, email]) });
  vPending.mounted(button, { value: true });
  button.focus();
  vPending.updated(button, { value: false, oldValue: true });
  assert.equal(document.activeElement, button, "focus moves only once the refusal's errors have drawn");
  await settled();
  assert.equal(document.activeElement, email);
  vPending.beforeUnmount(button);
});

test("outside a form the button's dialog, then the page, holds the marked fields", async () => {
  const document = createDocument();
  const inDialog = createField(document);
  const dialogButton = createButton(document, { dialog: scope([inDialog]) });
  vPending.mounted(dialogButton, { value: true });
  dialogButton.focus();
  vPending.updated(dialogButton, { value: false, oldValue: true });
  await settled();
  assert.equal(document.activeElement, inDialog);
  vPending.beforeUnmount(dialogButton);

  const onPage = createField(document);
  Object.assign(document, scope([onPage]));
  const barButton = createButton(document);
  vPending.mounted(barButton, { value: true });
  barButton.focus();
  vPending.updated(barButton, { value: false, oldValue: true });
  await settled();
  assert.equal(document.activeElement, onPage);
  vPending.beforeUnmount(barButton);
});

test("focus stays where it is when nothing is marked, when it left the button, or when the button goes", async () => {
  const document = createDocument();
  const accepted = createButton(document, { form: scope([]) });
  vPending.mounted(accepted, { value: true });
  accepted.focus();
  vPending.updated(accepted, { value: false, oldValue: true });
  await settled();
  assert.equal(document.activeElement, accepted);
  vPending.beforeUnmount(accepted);

  const marked = createField(document);
  const left = createButton(document, { form: scope([marked]) });
  const elsewhere = createField(document);
  vPending.mounted(left, { value: true });
  elsewhere.focus();
  vPending.updated(left, { value: false, oldValue: true });
  await settled();
  assert.equal(document.activeElement, elsewhere);
  vPending.beforeUnmount(left);

  const gone = createButton(document, { form: scope([marked]) });
  vPending.mounted(gone, { value: true });
  gone.focus();
  vPending.updated(gone, { value: false, oldValue: true });
  vPending.beforeUnmount(gone);
  await settled();
  assert.equal(document.activeElement, gone);
});
