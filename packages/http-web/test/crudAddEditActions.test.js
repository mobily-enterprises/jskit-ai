import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { compileScript, parse } from "@vue/compiler-sfc";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { computed, createRenderer, defineComponent, h, nextTick, ref, unref } from "vue";
import { createMemoryHistory, createRouter, useRoute } from "vue-router";
import { createSchema } from "json-rest-schema";
import { useCrudAddEditScreen } from "../src/client/composables/useCrudAddEditScreen.js";

const componentUrl = new URL("../src/client/components/CrudAddEditScreen.vue", import.meta.url).href;
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url !== componentUrl) return nextLoad(url, context);
    const { descriptor } = parse(readFileSync(new URL(url), "utf8"));
    return {
      format: "module",
      shortCircuit: true,
      source: compileScript(descriptor, { id: "crud-add-edit-actions", inlineTemplate: true }).content
    };
  }
});
const { default: CrudAddEditScreen } = await import(componentUrl);
hooks.deregister();

async function fixture(t, { actions, onSaveSuccess, request, ...options } = {}) {
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
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/books/:bookId?", component: { render: () => h("div") } }]
  });
  await router.push("/books/new?source=list");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const canSave = ref(true);
  const reports = [];
  const calls = [];
  let screen;
  const app = renderer.createApp({
    setup() {
      screen = useCrudAddEditScreen({
        mode: "new",
        saveLabel: "Save book",
        cancelTo: "/books/:bookId",
        preserveCancelQuery: true,
        formFields: [{ key: "title", type: "string" }, { key: "author", type: "string" }],
        input: {
          schema: createSchema({
            title: { type: "string", required: true, minLength: 1, messages: { minLength: "Title is required." } },
            author: { type: "string", required: true, minLength: 1, messages: { minLength: "Author is required." } }
          }),
          mode: "replace"
        },
        addEditOptions: {
          readEnabled: false,
          writeMethod: "POST",
          recordIdParam: "bookId",
          client: {
            async request(path, requestOptions) {
              calls.push({ path, ...requestOptions });
              return request ? request(path, requestOptions) : { id: calls.length, ...requestOptions.body };
            }
          },
          adapter: {
            useOperationScope() {
              return {
                routeContext: { route: useRoute(), currentSurfaceId: ref("admin") },
                scopeParamValue: ref(""),
                normalizedOwnershipFilter: "none",
                apiPath: ref("/api/books"),
                queryKey: ref(["books", "new"]),
                queryCanRun: () => ref(false),
                permissionGate: (key) => key === "save" ? canSave : ref(true),
                loadError: (value) => computed(() => unref(value)),
                isLoading: (value) => computed(() => unref(value))
              };
            }
          },
          onSaveSuccess: onSaveSuccess ? (payload, context) => onSaveSuccess(screen, payload, context) : undefined,
          ...options
        },
        saveSuccess: { navigateToView: false, navigateToList: false }
      });
      return () => h(CrudAddEditScreen, { screen }, {
        fields: ({ formState }) => h("input", {
          value: formState.title,
          onInput: (event) => { formState.title = event.target.value; }
        }),
        ...(actions ? { actions } : {})
      });
    }
  });
  app.use(router);
  app.use(VueQueryPlugin, { queryClient });
  app.provide("jskit.shell-web.runtime.web-error.client", {
    report(value) { reports.push(value); },
    dismiss() {}
  });
  for (const [name, tag] of [
    ["VBtn", "button"], ["VForm", "form"], ["VSheet", "div"], ["VRow", "div"], ["VSkeletonLoader", "div"]
  ]) {
    app.component(name, defineComponent({ setup: (_props, { slots }) => () => h(tag, {}, slots.default?.()) }));
  }
  const root = node("root");
  app.mount(root);
  t.after(() => { app.unmount(); queryClient.clear(); });
  const all = (item = root) => [item, ...item.children.flatMap((child) => all(child))];
  const button = (label) => all().find((item) => item.type === "button" &&
    all(item).some((child) => child.text.trim() === label));
  return { screen, router, queryClient, canSave, reports, calls, all, button };
}

test("default form actions retain Cancel, Save, validation feedback, and keyboard submission", async (t) => {
  const { screen, reports, calls, all, button } = await fixture(t);
  const { addEdit, formState } = screen;
  assert.deepEqual(button("Cancel").props.to, { path: "/books/new", query: { source: "list" } });
  assert.equal(button("Save book").props.disabled, false);
  assert.equal(addEdit.validationAttempted, false);
  assert.deepEqual(addEdit.validationErrors, {});

  await button("Save book").props.onClick();
  assert.equal(calls.length, 0);
  assert.equal(addEdit.validationAttempted, true);
  assert.deepEqual(addEdit.validationErrors, { title: "Title is required.", author: "Author is required." });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].cause.code, "validation_failed");

  formState.title = " A book ";
  assert.deepEqual(addEdit.validationErrors, { author: "Author is required." });
  formState.author = "An author";
  assert.deepEqual(addEdit.validationErrors, {});
  assert.equal(reports.length, 1);

  let prevented = false;
  await all().find((item) => item.type === "form").props.onSubmit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, { title: "A book", author: "An author" });
  assert.equal(reports.at(-1).severity, "success");
});

test("actions slot supports local guidance and save-and-add-another through onSaveSuccess", async (t) => {
  let actionScope;
  let saved;
  const activeAction = ref("");
  const { screen, reports, calls, all, button, queryClient, router } = await fixture(t, {
    validationFeedback: false,
    actions(scope) {
      actionScope = scope;
      return ["Save", "Save and add another"].map((label) => h("div", {}, [
        h("button", {
          onClick() { activeAction.value = label; return scope.submit(); },
          disabled: scope.addEdit.isSubmitDisabled
        }, label),
        activeAction.value === label && scope.addEdit.validationAttempted
          ? h("p", { "data-action": label }, Object.values(scope.addEdit.validationErrors).join(" "))
          : null
      ]));
    },
    onSaveSuccess(currentScreen, payload, context) {
      saved = { payload, context };
      Object.assign(currentScreen.formState, { title: "", author: "" });
      currentScreen.addEdit.resetValidation();
    }
  });
  const { addEdit, formState } = screen;
  assert.equal(button("Save book"), undefined);
  assert.equal(button("Cancel"), undefined);
  assert.equal(actionScope.screen, screen);
  assert.equal(actionScope.formState, formState);
  assert.equal(actionScope.formRuntime, screen.formRuntime);
  assert.equal(actionScope.addEdit, addEdit);
  assert.equal(actionScope.mode, "new");
  assert.equal(actionScope.saveLabel, "Save book");
  assert.deepEqual(actionScope.cancelTo, { path: "/books/new", query: { source: "list" } });

  await button("Save and add another").props.onClick();
  assert.equal(reports.length, 0);
  assert.equal(calls.length, 0);
  assert.equal(saved, undefined);
  assert.equal(addEdit.validationErrors.title, "Title is required.");
  assert.deepEqual(screen.resolveFieldErrors("title"), ["Title is required."]);
  await nextTick();
  assert.equal(all().find((item) => item.type === "p").props["data-action"], "Save and add another");
  assert.equal(all().find((item) => item.type === "p").text, "Title is required. Author is required.");
  formState.title = "First book";
  await nextTick();
  assert.equal(all().find((item) => item.type === "p").text, "Author is required.");
  await button("Save").props.onClick();
  await nextTick();
  assert.equal(all().find((item) => item.type === "p").props["data-action"], "Save");
  Object.assign(formState, { title: "First book", author: "An author" });
  assert.deepEqual(addEdit.validationErrors, {});
  await button("Save and add another").props.onClick();
  await nextTick();

  assert.equal(calls.length, 1);
  assert.equal(saved.payload.title, "First book");
  assert.equal(saved.context.queryClient, queryClient);
  assert.deepEqual(saved.context.parsed, { title: "First book", author: "An author" });
  assert.equal(formState.title, "");
  assert.equal(addEdit.validationAttempted, false);
  assert.deepEqual(addEdit.validationErrors, {});
  assert.deepEqual(screen.resolveFieldErrors("title"), []);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].severity, "success");
  assert.equal(router.currentRoute.value.path, "/books/new");

  await all().find((item) => item.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(addEdit.validationAttempted, true);
});

test("permission gating and duplicate-submit protection cover the request and success callback", async (t) => {
  const response = Promise.withResolvers();
  const success = Promise.withResolvers();
  const { screen, calls, canSave, button } = await fixture(t, {
    request: () => response.promise,
    onSaveSuccess: () => success.promise
  });
  const { addEdit, formState } = screen;
  canSave.value = false;
  await nextTick();
  assert.equal(button("Save book").props.disabled, true);
  await addEdit.submit();
  assert.equal(calls.length, 0);
  assert.equal(addEdit.validationAttempted, false);

  canSave.value = true;
  Object.assign(formState, { title: "Book", author: "Author" });
  const pending = addEdit.submit();
  await addEdit.submit();
  await nextTick();
  assert.equal(calls.length, 1);
  assert.equal(button("Saving…").props.disabled, true);
  assert.equal(addEdit.isFieldLocked, true);
  response.resolve({ id: 1, title: "Book", author: "Author" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(addEdit.resource.isSaving.value, false);
  assert.equal(addEdit.isSaving, true);
  await addEdit.submit();
  assert.equal(calls.length, 1);
  success.resolve();
  await pending;
  assert.equal(addEdit.isSaving, false);
  assert.equal(addEdit.isSubmitDisabled, false);
});

test("local validation feedback opt-out preserves permission, network, and server failure feedback", async (t) => {
  for (const error of [
    Object.assign(new Error("Permission denied."), { status: 403 }),
    new TypeError("Failed to fetch"),
    Object.assign(new Error("Title is already taken."), { status: 422, fieldErrors: { title: "Title is already taken." } }),
    Object.assign(new Error("Server unavailable."), { status: 503 })
  ]) {
    await t.test(error.message, async (t) => {
      let succeeded = false;
      const { screen, reports } = await fixture(t, {
        validationFeedback: false,
        request() { throw error; },
        onSaveSuccess() { succeeded = true; }
      });
      Object.assign(screen.formState, { title: "Book", author: "Author" });
      await screen.addEdit.submit();
      assert.equal(succeeded, false);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].cause, error);
      assert.equal(screen.addEdit.isSaving, false);
      assert.equal(screen.formState.title, "Book");
      assert.deepEqual(screen.addEdit.validationErrors, {});
      if (error.fieldErrors) {
        screen.formState.author = "Another author";
        assert.deepEqual(screen.addEdit.validationErrors, {});
        assert.deepEqual(screen.resolveFieldErrors("title"), [error.fieldErrors.title]);
      }
    });
  }
});

test("route cleanup resets validation attempts unless clearOnRouteChange is disabled", async (t) => {
  for (const clearOnRouteChange of [true, false]) {
    await t.test(String(clearOnRouteChange), async (t) => {
      const { screen, router } = await fixture(t, { clearOnRouteChange, validationFeedback: false });
      await screen.addEdit.submit();
      await router.push("/books/other");
      await nextTick();
      assert.equal(screen.addEdit.validationAttempted, !clearOnRouteChange);
      assert.equal(Object.keys(screen.addEdit.validationErrors).length, clearOnRouteChange ? 0 : 2);
      if (clearOnRouteChange) assert.deepEqual(screen.resolveFieldErrors("title"), []);
    });
  }
});
