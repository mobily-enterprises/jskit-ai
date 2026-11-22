import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRenderer, defineComponent, h, nextTick, reactive } from "vue";
import { compileScript, parse } from "@vue/compiler-sfc";

// The top-up component compiled and mounted with lightweight host controls: the amount it emits, in the currency's
// smallest unit, within the offer's limits; and each state of a top-up, the framed page's wait for the payment tab
// among them, with the events each control sends. The app's server decides every outcome.

/** The component, compiled into a temporary module whose catalog import points at the package. */
async function compileTopUp() {
  const file = new URL("../src/client/components/PaymentTopUp.vue", import.meta.url);
  const { descriptor, errors } = parse(await readFile(file, "utf8"), { filename: file.pathname });
  assert.deepEqual(errors, []);
  const compiled = compileScript(descriptor, { id: "payment-top-up", inlineTemplate: true });
  const directory = await mkdtemp(new URL("./.payment-top-up-", import.meta.url));
  const modulePath = `${directory}/component.mjs`;
  const i18nModule = new URL("../src/client/i18n.js", import.meta.url).href;
  await writeFile(modulePath, compiled.content.replace('"../i18n.js"', JSON.stringify(i18nModule)));
  const { default: PaymentTopUp } = await import(pathToFileURL(modulePath));
  return { PaymentTopUp, directory };
}

function mount(PaymentTopUp, props, events) {
  const node = (type, text = "") => ({ type, text, props: {}, children: [], parent: null });
  const renderer = createRenderer({
    createElement: node, createText: (text) => node("text", text), createComment: (text) => node("comment", text),
    setText: (item, text) => { item.text = text; },
    setElementText: (item, text) => { item.text = text; item.children = []; },
    patchProp: (item, key, _previous, value) => { item.props[key] = value; },
    parentNode: (item) => item.parent,
    nextSibling: (item) => item.parent?.children[item.parent.children.indexOf(item) + 1] ?? null,
    insert(item, parent, anchor) {
      if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1);
      item.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(item); else parent.children.splice(index, 0, item);
    },
    remove(item) { if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1); }
  });
  const root = node("root");
  const app = renderer.createApp({ render: () => h(PaymentTopUp, {
    ...props,
    "onTop-up": (amount) => events.push(["top-up", amount]),
    "onOpen-payment": () => events.push(["open-payment"]),
    onCheck: () => events.push(["check"]),
    onDismiss: () => events.push(["dismiss"])
  }) });
  app.component("VBtn", defineComponent({ inheritAttrs: false, setup: (_props, { slots, attrs }) => () => h("button", { disabled: attrs.disabled, onClick: attrs.onClick }, slots.default?.()) }));
  app.component("VTextField", defineComponent({ inheritAttrs: false, setup: (_props, { attrs }) => () => h("input", { ...attrs }) }));
  app.mount(root);
  const all = (item = root) => [item, ...item.children.flatMap((child) => all(child))];
  return {
    app,
    text: () => all().map((item) => item.text).join(" ").replace(/\s+/gu, " "),
    input: () => all().find((item) => item.type === "input"),
    button: (label) => all().find((item) => item.type === "button" && all(item).some((child) => child.text === label))
  };
}

test("the top-up chooser emits an amount in the currency's smallest unit, only within the offer's limits", async (t) => {
  globalThis.window = new EventTarget();
  const { PaymentTopUp, directory } = await compileTopUp();
  const props = reactive({ offer: { currency: "USD", minimumAmount: 100, maximumAmount: 50000 }, presets: [500, 2000], canTopUp: true, pending: false, topUp: null, paymentPage: "", locale: "en-US" });
  const events = [];
  const view = mount(PaymentTopUp, props, events);
  t.after(async () => {
    view.app.unmount();
    delete globalThis.window;
    await rm(directory, { recursive: true, force: true });
  });
  assert.equal(view.input().props.label, "Amount (USD)");
  assert.equal(view.input().props.hint, "From $1.00 to $500.00");
  const type = async (value) => {
    view.input().props["onUpdate:modelValue"](value);
    await nextTick();
  };
  await type("12.5");
  view.button("Top up").props.onClick();
  assert.deepEqual(events, [["top-up", 1250]], "12.5 dollars is 1250 cents, read from its digits");
  for (const value of ["0.99", "500.01", "12.345", "1e3", "-5", "abc"]) {
    await type(value);
    assert.equal(view.button("Top up").props.disabled, true, value);
    assert.deepEqual(view.input().props["error-messages"], ["Enter an amount from $1.00 to $500.00."], value);
    view.button("Top up").props.onClick();
  }
  assert.equal(events.length, 1, "no amount outside the limits is emitted");
  await type("500,00");
  view.button("Top up").props.onClick();
  assert.deepEqual(events.at(-1), ["top-up", 50000], "a comma separates the cents too");
  view.button("$20.00").props.onClick();
  await nextTick();
  assert.equal(view.input().props.modelValue, "20.00");
  view.button("Top up").props.onClick();
  assert.deepEqual(events.at(-1), ["top-up", 2000]);

  props.pending = true;
  await nextTick();
  view.button("Top up").props.onClick();
  assert.equal(events.length, 3, "nothing is emitted while a request runs");
  props.pending = false;
  props.canTopUp = false;
  await nextTick();
  assert.equal(view.button("Top up").props.disabled, true);
  assert.match(view.text(), /A billing administrator can top up this account/u);

  props.offer = { currency: "JPY", minimumAmount: 100, maximumAmount: 100000 };
  props.canTopUp = true;
  await type("1500");
  view.button("Top up").props.onClick();
  assert.deepEqual(events.at(-1), ["top-up", 1500], "a currency without decimals counts whole units");
  await type("1500.5");
  assert.equal(view.button("Top up").props.disabled, true);
});

test("a framed page waits for the payment tab, and each top-up state offers its own next step", async (t) => {
  globalThis.window = new EventTarget();
  const { PaymentTopUp, directory } = await compileTopUp();
  const topUp = { topUpId: "a".repeat(64), status: "open", amount: 1250, currency: "USD", url: "https://checkout.stripe.com/c/pay/cs_test_a1" };
  const props = reactive({ offer: { currency: "USD", minimumAmount: 100, maximumAmount: 50000 }, presets: [], canTopUp: true, pending: false, topUp, paymentPage: "opened", locale: "en-US" });
  const events = [];
  const view = mount(PaymentTopUp, props, events);
  t.after(async () => {
    view.app.unmount();
    delete globalThis.window;
    await rm(directory, { recursive: true, force: true });
  });
  assert.match(view.text(), /Waiting for your payment…/u);
  assert.match(view.text(), /Pay \$12\.50 in the new tab/u);
  assert.equal(view.input(), undefined, "no second top-up starts while one waits");
  view.button("Check payment").props.onClick();
  view.button("Open the payment page again").props.onClick();
  view.button("Cancel").props.onClick();
  assert.deepEqual(events.splice(0), [["check"], ["open-payment"], ["dismiss"]]);
  globalThis.window.dispatchEvent(new Event("focus"));
  assert.deepEqual(events.splice(0), [["check"]], "coming back to the page checks the payment");
  props.pending = true;
  await nextTick();
  globalThis.window.dispatchEvent(new Event("focus"));
  assert.deepEqual(events, [], "but not while a check runs");
  props.pending = false;

  props.paymentPage = "blocked";
  await nextTick();
  assert.match(view.text(), /Your browser blocked the payment tab/u);
  view.button("Open the payment page").props.onClick();
  assert.deepEqual(events.splice(0), [["open-payment"]]);
  globalThis.window.dispatchEvent(new Event("focus"));
  assert.deepEqual(events, [], "a tab that never opened is not checked on focus");

  props.paymentPage = "redirected";
  await nextTick();
  assert.match(view.text(), /Opening the payment page…/u);
  props.paymentPage = "";
  await nextTick();
  assert.match(view.text(), /The payment of \$12\.50 is not complete yet/u, "the return page, back without paying");

  for (const [status, message, next] of [
    ["processing", /Your payment of \$12\.50 is being processed/u, "Done"],
    ["paid", /\$12\.50 was added to your balance/u, "Top up again"],
    ["failed", /The payment of \$12\.50 failed\. Nothing was added/u, "Try again"],
    ["expired", /The payment page for \$12\.50 expired\. Nothing was added/u, "Try again"]
  ]) {
    props.topUp = { ...topUp, status, url: null };
    await nextTick();
    assert.match(view.text(), message, status);
    assert.doesNotMatch(view.text(), /Waiting for your payment/u, status);
    view.button(next).props.onClick();
    assert.deepEqual(events.splice(0), [["dismiss"]], status);
  }
  props.topUp = null;
  await nextTick();
  assert.equal(view.input().props.label, "Amount (USD)", "dismissed, the chooser is back");
});
