import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { computed, createSSRApp, effectScope, h, nextTick, reactive, ref } from "vue";
import { useAddEditCore } from "../src/client/composables/runtime/useAddEditCore.js";
import { useEndpointResource } from "../src/client/composables/runtime/useEndpointResource.js";

// A form's record is read again while the person edits it: a realtime event, the window regaining focus and Retry
// each refetch the form's query. These drive the form runtime over a real query client, against a fake server whose
// records a test changes as another person saving them would.

/** Lets the query client's reads and the watchers they trigger run. */
async function settle() {
  for (let round = 0; round < 6; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    await nextTick();
  }
}

function editForm(t, { records, recordId = "1" }) {
  const server = structuredClone(records);
  const saves = [];
  let savesHeld = null;
  const client = {
    async request(path, options) {
      const id = path.split("/").at(-1);
      if (options.method === "GET") {
        return structuredClone(server[id]);
      }
      saves.push(structuredClone(options.body));
      await savesHeld?.promise;
      // The server trims what it stores, so a saved response can differ from what the form sent.
      server[id] = { ...server[id], title: options.body.title.trim(), author: options.body.author.trim() };
      return structuredClone(server[id]);
    }
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = createSSRApp({ render: () => h("div") });
  app.use(VueQueryPlugin, { queryClient });
  const id = ref(recordId);
  const model = reactive({ title: "", author: "" });
  const scope = effectScope();
  let form = null;
  app.runWithContext(() => {
    scope.run(() => {
      const queryKey = computed(() => ["books", id.value]);
      const resource = useEndpointResource({ queryKey, path: computed(() => `/books/${id.value}`), client });
      form = useAddEditCore({
        model,
        resource,
        queryKey,
        canSave: ref(true),
        fieldBag: { clear() {}, apply() {} },
        feedback: { clear() {}, success() {}, error() {} },
        mapLoadedToModel(target, loaded) {
          target.title = loaded.title;
          target.author = loaded.author;
        },
        buildRawPayload: (current) => ({ title: current.title, author: current.author })
      });
    });
  });
  t.after(() => {
    scope.stop();
    queryClient.clear();
  });

  return {
    server,
    saves,
    model,
    form,
    queryClient,
    id,
    holdSaves() {
      savesHeld = Promise.withResolvers();
      return savesHeld;
    },
    async readAgain() {
      await queryClient.refetchQueries({ queryKey: ["books", id.value], exact: true });
      await settle();
    }
  };
}

const DUNE = Object.freeze({ title: "Dune", author: "Herbert" });

test("a record read again keeps the field the person edited and takes the fields they left", async (t) => {
  const fixture = editForm(t, { records: { 1: DUNE } });
  await settle();
  assert.deepEqual({ ...fixture.model }, DUNE);

  fixture.model.title = "Dune (draft)";
  fixture.server[1].author = "Frank Herbert";
  await fixture.readAgain();

  assert.equal(fixture.model.title, "Dune (draft)", "the read kept the person's unsaved title");
  assert.equal(fixture.model.author, "Frank Herbert", "the field the person left took the server's new value");
  assert.deepEqual(fixture.form.conflicts.value, [], "the server's title did not change, so nothing conflicts");
});

test("a server change to a field the person edited keeps both values, and the person chooses", async (t) => {
  const fixture = editForm(t, { records: { 1: DUNE } });
  await settle();

  fixture.model.title = "Dune (draft)";
  fixture.server[1].title = "Dune Messiah";
  await fixture.readAgain();
  assert.equal(fixture.model.title, "Dune (draft)");
  assert.deepEqual(fixture.form.conflicts.value, [{ key: "title", value: "Dune Messiah" }]);

  // Another read with the server's value unchanged keeps the conflict as it is.
  await fixture.readAgain();
  assert.deepEqual(fixture.form.conflicts.value, [{ key: "title", value: "Dune Messiah" }]);

  fixture.form.acceptServerValue("title");
  assert.equal(fixture.model.title, "Dune Messiah");
  assert.deepEqual(fixture.form.conflicts.value, []);

  // The accepted value is the server's, so the field is no longer the person's edit: the next change reaches it.
  fixture.server[1].title = "Children of Dune";
  await fixture.readAgain();
  assert.equal(fixture.model.title, "Children of Dune");
  assert.deepEqual(fixture.form.conflicts.value, []);
});

test("keeping one's own value ends the conflict until the server changes that field again", async (t) => {
  const fixture = editForm(t, { records: { 1: DUNE } });
  await settle();

  fixture.model.title = "Mine";
  fixture.server[1].title = "Theirs";
  await fixture.readAgain();
  fixture.form.keepOwnValue("title");
  assert.equal(fixture.model.title, "Mine");
  assert.deepEqual(fixture.form.conflicts.value, []);

  await fixture.readAgain();
  assert.equal(fixture.model.title, "Mine");
  assert.deepEqual(fixture.form.conflicts.value, [], "the same server value does not conflict again");

  fixture.server[1].title = "Theirs, again";
  await fixture.readAgain();
  assert.equal(fixture.model.title, "Mine");
  assert.deepEqual(fixture.form.conflicts.value, [{ key: "title", value: "Theirs, again" }]);
});

test("a field the person changed back to the server's value takes the next read", async (t) => {
  const fixture = editForm(t, { records: { 1: DUNE } });
  await settle();

  fixture.model.title = "Dune (draft)";
  fixture.model.title = "Dune";
  fixture.server[1].title = "Dune Messiah";
  await fixture.readAgain();
  assert.equal(fixture.model.title, "Dune Messiah");
  assert.deepEqual(fixture.form.conflicts.value, []);
});

test("a server value that reaches what the person typed ends their conflict", async (t) => {
  const fixture = editForm(t, { records: { 1: DUNE } });
  await settle();

  fixture.model.title = "Dune Messiah";
  fixture.server[1].title = "Dune II";
  await fixture.readAgain();
  assert.deepEqual(fixture.form.conflicts.value, [{ key: "title", value: "Dune II" }]);

  fixture.server[1].title = "Dune Messiah";
  await fixture.readAgain();
  assert.equal(fixture.model.title, "Dune Messiah");
  assert.deepEqual(fixture.form.conflicts.value, []);
});

test("a save takes its response for the fields it sent and keeps a field changed while it ran", async (t) => {
  const fixture = editForm(t, { records: { 1: DUNE } });
  await settle();

  fixture.model.title = "  Dune Messiah ";
  const held = fixture.holdSaves();
  const saving = fixture.form.submit();
  await settle();
  assert.deepEqual(fixture.saves, [{ title: "  Dune Messiah ", author: "Herbert" }]);
  fixture.model.author = "Frank Herbert";
  held.resolve();
  await saving;
  await settle();

  assert.equal(fixture.model.title, "Dune Messiah", "the field the save sent took the server's stored value");
  assert.equal(fixture.model.author, "Frank Herbert", "the field changed while the save ran kept the person's value");
  assert.deepEqual(fixture.form.conflicts.value, []);
});

test("saving a field in conflict saves the person's value and ends the conflict", async (t) => {
  const fixture = editForm(t, { records: { 1: DUNE } });
  await settle();

  fixture.model.title = "Mine";
  fixture.server[1].title = "Theirs";
  await fixture.readAgain();
  assert.deepEqual(fixture.form.conflicts.value, [{ key: "title", value: "Theirs" }]);

  await fixture.form.submit();
  await settle();
  assert.deepEqual(fixture.saves, [{ title: "Mine", author: "Herbert" }]);
  assert.equal(fixture.model.title, "Mine");
  assert.deepEqual(fixture.form.conflicts.value, []);
});

test("opening another record shows that record, never the last record's edits", async (t) => {
  const fixture = editForm(t, { records: { 1: DUNE, 2: { title: "Emma", author: "Austen" } } });
  await settle();
  fixture.model.title = "Dune (draft)";
  fixture.server[1].title = "Dune Messiah";
  await fixture.readAgain();
  assert.equal(fixture.form.conflicts.value.length, 1);

  // Record 2 is already cached, as after visiting it, so the form gets its data without a pending read.
  fixture.queryClient.setQueryData(["books", "2"], { title: "Emma", author: "Austen" });
  fixture.id.value = "2";
  await settle();
  assert.deepEqual({ ...fixture.model }, { title: "Emma", author: "Austen" });
  assert.deepEqual(fixture.form.conflicts.value, []);

  // Back on record 1, the form shows record 1 again; the edit made on record 2 stays behind.
  fixture.model.title = "Emma (draft)";
  fixture.id.value = "1";
  await settle();
  assert.deepEqual({ ...fixture.model }, { title: "Dune Messiah", author: "Herbert" });
  assert.deepEqual(fixture.form.conflicts.value, []);
});

test("a record another read hands the form, as a settings page's shared read does, keeps the person's edits too", async (t) => {
  const fixture = editForm(t, { records: { 1: DUNE } });
  await settle();

  fixture.model.title = "Dune (draft)";
  fixture.form.applyLoaded({ title: "Dune Messiah", author: "Frank Herbert" });
  assert.equal(fixture.model.title, "Dune (draft)");
  assert.equal(fixture.model.author, "Frank Herbert");
  assert.deepEqual(fixture.form.conflicts.value, [{ key: "title", value: "Dune Messiah" }]);
});
