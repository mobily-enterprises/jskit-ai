import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createRenderer, h, reactive } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { SHELL_WEB_ERROR_RUNTIME_KEY } from "@jskit-ai/shell-web/client/error";
import { useAddEdit } from "../src/client/composables/records/useAddEdit.js";
import { useCrudList } from "../src/client/composables/records/useCrudList.js";
import { useList } from "../src/client/composables/records/useList.js";
import { useView } from "../src/client/composables/records/useView.js";

// A failed load's notice offers Retry only while trying again may succeed. `status` undefined is an error that
// carries none, as a network failure or an error thrown before any request.
const LOAD_FAILURES = Object.freeze([
  { status: undefined, retry: true },
  { status: 408, retry: true },
  { status: 429, retry: true },
  { status: 500, retry: true },
  { status: 503, retry: true },
  { status: 401, retry: false },
  { status: 403, retry: false },
  { status: 404, retry: false },
  { status: 422, retry: false }
]);

const node = (type, text = "") => ({ type, text, props: {}, children: [], parent: null });
const renderer = createRenderer({
  createElement: node,
  createText: (text) => node("text", text),
  createComment: () => node("comment"),
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
  remove(item) {
    if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1);
  }
});

function describeStatus(status) {
  return status === undefined ? "no status" : String(status);
}

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(message);
}

// Mounts one runtime whose every read fails with `status` (and `message`, by default one of the server's own, and the
// server's `code` when given), and records what it reports to the shell.
async function mountFailingLoad(t, status, useRuntime, {
  message = `Contacts refused the read (${describeStatus(status)}).`,
  code
} = {}) {
  const requests = [];
  const client = {
    async request(path) {
      requests.push(path);
      const error = new Error(message);
      if (status !== undefined) {
        error.status = status;
      }
      if (code) {
        error.code = code;
      }
      throw error;
    }
  };
  const reports = [];
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/contacts/:recordId?", component: { render: () => h("div") } }]
  });
  await router.push("/contacts/7");
  await router.isReady();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let runtime = null;
  const app = renderer.createApp({
    setup() {
      runtime = useRuntime(client);
      return () => h("div");
    }
  });
  app.use(router);
  app.use(VueQueryPlugin, { queryClient });
  app.provide(SHELL_WEB_ERROR_RUNTIME_KEY, {
    report(event) {
      reports.push(event);
      return { presentationId: `presentation-${reports.length}` };
    },
    dismiss() {}
  });
  app.mount(node("root"));
  t.after(() => {
    app.unmount();
    queryClient.clear();
  });

  await waitFor(
    () => reports.some((event) => event.intent === "resource-load"),
    `Expected a load notice for a ${describeStatus(status)} failure.`
  );
  return { runtime, reports, requests };
}

// The load notices' Retry, checked against what the failure should offer: the action, or null for a refusal.
function assertRetryOffer({ reports }, { status, retry }) {
  const notices = reports.filter((event) => event.intent === "resource-load");
  const actions = notices.map((event) => event.action).filter(Boolean);
  if (!retry) {
    assert.deepEqual(actions, [], `A ${describeStatus(status)} refusal offers no Retry.`);
    return null;
  }

  assert.equal(actions.length, 1, `A ${describeStatus(status)} failure offers Retry.`);
  assert.equal(actions[0].label, "Retry");
  assert.equal(actions[0].dismissOnRun, true);
  return actions[0];
}

// Runs the Retry, which loads again. The status is read before: the new attempt clears the failed one's error.
async function assertRetryLoadsAgain({ requests }, retryAction) {
  if (!retryAction) {
    return;
  }

  const requestsBefore = requests.length;
  retryAction.handler();
  await waitFor(() => requests.length > requestsBefore, "Retry loads again.");
}

function listOptions(client) {
  return {
    apiSuffix: "/contacts",
    ownershipFilter: "public",
    client,
    queryKeyFactory: () => ["contacts"]
  };
}

for (const failure of LOAD_FAILURES) {
  const label = describeStatus(failure.status);

  test(`useView: a ${label} load failure ${failure.retry ? "offers" : "does not offer"} Retry and exposes its status`, async (t) => {
    const mounted = await mountFailingLoad(t, failure.status, (client) => useView({
      apiSuffix: "/contacts/7",
      ownershipFilter: "public",
      client,
      queryKeyFactory: () => ["contacts", "7"]
    }));

    const retryAction = assertRetryOffer(mounted, failure);
    assert.equal(mounted.runtime.errorStatus, failure.status ?? 0);
    await assertRetryLoadsAgain(mounted, retryAction);
  });

  test(`useList: a ${label} load failure ${failure.retry ? "offers" : "does not offer"} Retry and exposes its status`, async (t) => {
    const mounted = await mountFailingLoad(t, failure.status, (client) => useList(listOptions(client)));

    const retryAction = assertRetryOffer(mounted, failure);
    assert.ok(mounted.runtime.loadError, "The message stays.");
    assert.equal(mounted.runtime.errorStatus, failure.status ?? 0);
    await assertRetryLoadsAgain(mounted, retryAction);
  });
}

test("useCrudList offers no Retry after a refused load, and exposes its status", async (t) => {
  const mounted = await mountFailingLoad(t, 403, (client) => useCrudList(listOptions(client)));

  assertRetryOffer(mounted, { status: 403, retry: false });
  assert.ok(mounted.runtime.loadError);
  assert.equal(mounted.runtime.errorStatus, 403);
});

test("useCrudList offers Retry after a network failure, whose status is 0", async (t) => {
  const mounted = await mountFailingLoad(t, undefined, (client) => useCrudList(listOptions(client)));

  const retryAction = assertRetryOffer(mounted, { status: undefined, retry: true });
  assert.equal(mounted.runtime.errorStatus, 0);
  await assertRetryLoadsAgain(mounted, retryAction);
});

for (const failure of [{ status: 503, retry: true }, { status: 403, retry: false }]) {
  test(`useAddEdit: a ${failure.status} load failure ${failure.retry ? "offers" : "does not offer"} Retry`, async (t) => {
    const mounted = await mountFailingLoad(t, failure.status, (client) => useAddEdit({
      apiSuffix: "/contacts/7",
      ownershipFilter: "public",
      client,
      queryKeyFactory: () => ["contacts", "7", "edit"],
      model: reactive({ name: "" })
    }));

    assert.equal(mounted.runtime.canRetryLoad, true, "The form's own Retry button is unchanged.");
    await assertRetryLoadsAgain(mounted, assertRetryOffer(mounted, failure));
  });
}

// What a screen says about a refused load (`loadRefusalMessage`): the server's message when the error carries one,
// else a neutral text for the refusal's kind; empty where trying again may help. A message of `null` is the one the
// HTTP client builds when the server sent none ("Request failed with status 403.").
const LOAD_REFUSALS = Object.freeze([
  { label: "a network failure", status: undefined, message: "Network request failed.", refusal: "" },
  { label: "a 503", status: 503, message: null, refusal: "" },
  { label: "a 401 without a message", status: 401, message: null, refusal: "Sign in again to see this." },
  { label: "a 403 without a message", status: 403, message: null, refusal: "You don't have access to this." },
  { label: "a 404 without a message", status: 404, message: null, refusal: "This wasn't found." },
  { label: "a 422 without a message", status: 422, message: null, refusal: "This couldn't be loaded." },
  {
    label: "a 403 with the server's message",
    status: 403,
    message: "Only editors can read contacts.",
    refusal: "Only editors can read contacts."
  }
]);

const REFUSAL_RUNTIMES = Object.freeze({
  useList: (client) => useList(listOptions(client)),
  useView: (client) => useView({
    apiSuffix: "/contacts/7",
    ownershipFilter: "public",
    client,
    queryKeyFactory: () => ["contacts", "7"]
  }),
  useAddEdit: (client) => useAddEdit({
    apiSuffix: "/contacts/7",
    ownershipFilter: "public",
    client,
    queryKeyFactory: () => ["contacts", "7", "edit"],
    model: reactive({ name: "" })
  })
});

for (const [name, useRuntime] of Object.entries(REFUSAL_RUNTIMES)) {
  for (const { label, status, message, refusal } of LOAD_REFUSALS) {
    test(`${name}: loadRefusalMessage after ${label} is ${refusal ? `"${refusal}"` : "empty"}`, async (t) => {
      const mounted = await mountFailingLoad(t, status, useRuntime, {
        message: message ?? `Request failed with status ${status}.`
      });

      assert.equal(mounted.runtime.loadRefusalMessage, refusal);
    });
  }
}

// A list that asks for a query key it does not take (crud-core's 400 crud.query.undeclaredKeys): the person reads the
// server's plain sentence and is offered no Retry, since the same page asks for the same key again.
test("useCrudList: a 400 for a query key the list does not take says the server's plain sentence and offers no Retry", async (t) => {
  const sentence = "This page asked for something the server doesn't recognise, so nothing was loaded. Reload the page; " +
    "if it keeps happening, tell support.";
  const mounted = await mountFailingLoad(t, 400, (client) => useCrudList(listOptions(client)), {
    message: sentence,
    code: "crud.query.undeclaredKeys"
  });

  assertRetryOffer(mounted, { status: 400, retry: false });
  assert.equal(mounted.runtime.errorStatus, 400);
  assert.equal(mounted.runtime.loadRefusalMessage, sentence);
});
