import assert from "node:assert/strict";
import test from "node:test";

test("useCrudListRowActions manages per-record state and executes action context", async () => {
  const { defineCrudListRowActions } = await import("@jskit-ai/users-web/client/rowActions");
  const { useCrudListRowActions } = await import("@jskit-ai/users-web/client/composables/useCrudListRowActions");
  const calls = [];
  let finishRun = null;
  const actions = defineCrudListRowActions([
    {
      key: "delete",
      label: "Delete",
      color: "error",
      visible: ({ record }) => record.isOwnerRow !== true,
      disabled: ({ record }) => record.locked === true,
      loading: ({ record }) => record.pending === true,
      async run(context) {
        calls.push(context);
        await new Promise((resolve) => {
          finishRun = resolve;
        });
        return "deleted";
      }
    }
  ]);
  const runtime = useCrudListRowActions(actions, {
    resolveRecordId: (record) => record.id,
    resolveContext: () => ({
      records: "records-token",
      reload: "reload-token"
    })
  });

  assert.equal(runtime.hasActions.value, true);
  assert.equal(runtime.hasVisibleActionsFor({ id: "owner", isOwnerRow: true }, 0), false);
  assert.equal(runtime.isActionDisabled("delete", { id: "locked", locked: true }, 1), true);
  assert.equal(runtime.isActionLoading("delete", { id: "pending", pending: true }, 2), true);

  const record = { id: "10", name: "Worker" };
  assert.equal(runtime.isActionVisible("delete", record, 3), true);
  assert.equal(runtime.isActionDisabled("delete", record, 3), false);

  const result = runtime.execute("delete", record, 3);
  assert.equal(runtime.isActionExecuting("delete", record, 3), true);
  assert.equal(runtime.isActionLoading("delete", record, 3), true);
  finishRun();

  assert.equal(await result, "deleted");
  assert.equal(runtime.isActionExecuting("delete", record, 3), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action.key, "delete");
  assert.equal(calls[0].record, record);
  assert.equal(calls[0].index, 3);
  assert.equal(calls[0].recordId, "10");
  assert.equal(calls[0].records, "records-token");
  assert.equal(calls[0].reload, "reload-token");
});

test("defineCrudListRowActions skips malformed and duplicate actions", async () => {
  const { defineCrudListRowActions } = await import("@jskit-ai/users-web/client/rowActions");

  const actions = defineCrudListRowActions([
    null,
    { key: "delete", label: "Delete", color: "error" },
    { key: "delete", label: "Delete again" },
    { key: "missing-label" },
    { label: "Generated key" }
  ]);

  assert.deepEqual(
    actions.map((action) => [action.key, action.label, action.color]),
    [
      ["delete", "Delete", "error"],
      ["action-5", "Generated key", "primary"]
    ]
  );
});
