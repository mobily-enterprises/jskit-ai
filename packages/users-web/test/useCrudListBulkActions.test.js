import assert from "node:assert/strict";
import test from "node:test";
import { nextTick } from "vue";

test("useCrudListBulkActions manages selection and executes action context", async () => {
  const { defineCrudListBulkActions } = await import("@jskit-ai/users-web/client/bulkActions");
  const { useCrudListBulkActions } = await import("@jskit-ai/users-web/client/composables/useCrudListBulkActions");
  const calls = [];
  const actions = defineCrudListBulkActions([
    {
      key: "archive",
      label: "Archive",
      async run(context) {
        calls.push(context);
        context.clearSelection();
      }
    }
  ]);
  const runtime = useCrudListBulkActions(actions, {
    resolveRecordId: (record) => record.id,
    resolveContext: () => ({
      reload: "reload-token"
    })
  });

  assert.equal(runtime.hasActions.value, true);
  assert.equal(runtime.hasSelection.value, false);

  runtime.setRecordSelected({ id: "10", label: "A" }, 0, true);
  runtime.setRecordSelected({ id: "11", label: "B" }, 1, true);
  await nextTick();

  assert.deepEqual(runtime.selectedIds.value, ["10", "11"]);
  assert.equal(runtime.selectedCount.value, 2);
  assert.equal(runtime.allVisibleSelected([{ id: "10" }, { id: "11" }]), true);
  assert.equal(runtime.someVisibleSelected([{ id: "10" }, { id: "12" }]), true);

  await runtime.execute("archive");

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].selectedIds, ["10", "11"]);
  assert.deepEqual(calls[0].ids, ["10", "11"]);
  assert.equal(calls[0].reload, "reload-token");
  assert.equal(runtime.selectedCount.value, 0);
});

test("defineCrudListBulkActions skips malformed and duplicate actions", async () => {
  const { defineCrudListBulkActions } = await import("@jskit-ai/users-web/client/bulkActions");

  const actions = defineCrudListBulkActions([
    null,
    { key: "archive", label: "Archive" },
    { key: "archive", label: "Archive again" },
    { key: "missing-label" },
    { label: "Generated key" }
  ]);

  assert.deepEqual(
    actions.map((action) => [action.key, action.label, action.color, action.variant]),
    [
      ["archive", "Archive", "primary", "tonal"],
      ["action-5", "Generated key", "primary", "tonal"]
    ]
  );
});
