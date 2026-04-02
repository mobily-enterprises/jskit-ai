import test from "node:test";
import assert from "node:assert/strict";
import { createHooksToCollectChildren } from "../src/server/createHooksToCollectChildren.js";

test("createHooksToCollectChildren batches children and hydrates returned records", async () => {
  const calls = [];
  const hooks = createHooksToCollectChildren({
    childKey: "pets",
    childOwnerIdKey: "contactId",
    async listChildren(contactIds = [], options = {}) {
      calls.push({
        contactIds,
        options
      });
      return [
        { id: 100, contactId: 7, name: "Milo" },
        { id: 101, contactId: 7, name: "Luna" },
        { id: 200, contactId: 8, name: "Mochi" }
      ];
    }
  });

  const context = {
    callOptions: {
      trx: { id: "trx-1" },
      visibilityContext: { visibility: "workspace", scopeOwnerId: "workspace-1" },
      ignored: true
    },
    state: {}
  };
  const records = [{ id: 7, firstName: "Tony" }, { id: 8, firstName: "Sara" }, { id: 7, firstName: "Tony2" }];

  await hooks.afterQuery(records, context);
  const hydrated = records.map((record) => hooks.transformReturnedRecord(record, context));

  assert.deepEqual(calls, [
    {
      contactIds: [7, 8],
      options: {
        trx: context.callOptions.trx,
        visibilityContext: context.callOptions.visibilityContext
      }
    }
  ]);
  assert.deepEqual(hydrated[0].lookups?.pets?.map((entry) => entry.name), ["Milo", "Luna"]);
  assert.deepEqual(hydrated[1].lookups?.pets?.map((entry) => entry.name), ["Mochi"]);
});

test("createHooksToCollectChildren supports childRepository + childListMethod shorthand", async () => {
  const calls = [];
  const childRepository = {
    async listByContactIds(contactIds = [], options = {}) {
      calls.push({
        contactIds,
        options
      });
      return [{ id: 1, contactId: 9 }];
    }
  };
  const hooks = createHooksToCollectChildren({
    childKey: "pets",
    childOwnerIdKey: "contactId",
    childRepository,
    childListMethod: "listByContactIds"
  });

  const context = {
    callOptions: {
      trx: { id: "trx-2" }
    },
    state: {}
  };
  await hooks.afterQuery([{ id: 9 }], context);
  const hydrated = hooks.transformReturnedRecord({ id: 9 }, context);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].contactIds, [9]);
  assert.deepEqual(calls[0].options, {
    trx: context.callOptions.trx
  });
  assert.equal(hydrated.lookups?.pets?.length, 1);
});

test("createHooksToCollectChildren uses childRepository.listByIds by default", async () => {
  const calls = [];
  const childRepository = {
    async listByIds(contactIds = [], options = {}) {
      calls.push({
        contactIds,
        options
      });
      return [{ id: 11, customerId: 9, name: "Milo" }];
    }
  };
  const hooks = createHooksToCollectChildren({
    childKey: "pets",
    childRepository,
    childForeignKey: "customerId"
  });

  const context = {
    callOptions: {
      trx: { id: "trx-4" }
    },
    state: {}
  };
  await hooks.afterQuery([{ id: 9 }], context);
  const hydrated = hooks.transformReturnedRecord({ id: 9 }, context);

  assert.deepEqual(calls, [
    {
      contactIds: [9],
      options: {
        trx: context.callOptions.trx,
        valueKey: "customerId"
      }
    }
  ]);
  assert.equal(hydrated.lookups?.pets?.length, 1);
});

test("createHooksToCollectChildren supports override hooks for parent id, child owner id, call options, and attach", async () => {
  const calls = [];
  const hooks = createHooksToCollectChildren({
    childKey: "pets",
    listChildren(contactIds = [], options = {}) {
      calls.push({
        contactIds,
        options
      });
      return [{ id: "p-1", ownerId: "contact-15" }];
    },
    getParentId(record = {}) {
      return `contact-${record.contactId}`;
    },
    getChildOwnerId(child = {}) {
      return child.ownerId;
    },
    buildChildCallOptions({ callOptions = {}, ownerIds = [] } = {}) {
      return {
        trx: callOptions.trx || null,
        includeArchived: ownerIds.length > 0
      };
    },
    attachChildren(record = {}, children = []) {
      return {
        ...record,
        petCount: children.length
      };
    }
  });

  const context = {
    callOptions: {
      trx: { id: "trx-3" }
    },
    state: {}
  };
  await hooks.afterQuery([{ contactId: 15 }], context);
  const hydrated = hooks.transformReturnedRecord({ contactId: 15 }, context);

  assert.deepEqual(calls, [
    {
      contactIds: ["contact-15"],
      options: {
        trx: context.callOptions.trx,
        includeArchived: true
      }
    }
  ]);
  assert.deepEqual(hydrated, {
    contactId: 15,
    petCount: 1
  });
});

test("createHooksToCollectChildren validates required configuration", async () => {
  assert.throws(
    () =>
      createHooksToCollectChildren({
        childOwnerIdKey: "contactId",
        async listChildren() {
          return [];
        }
      }),
    /requires childKey/
  );

  assert.throws(
    () =>
      createHooksToCollectChildren({
        childKey: "pets",
        async listChildren() {
          return [];
        }
      }),
    /requires childOwnerIdKey, childForeignKey, or getChildOwnerId/
  );

  assert.throws(
    () =>
      createHooksToCollectChildren({
        childKey: "pets"
      }),
    /requires listChildren\(ids, options, ctx\) or childRepository/
  );

  assert.throws(
    () =>
      createHooksToCollectChildren({
        childKey: "pets",
        childRepository: {
          async listByIds() {
            return [];
          }
        }
      }),
    /requires childForeignKey when using childRepository\.listByIds/
  );

  const hooks = createHooksToCollectChildren({
    childKey: "pets",
    childOwnerIdKey: "contactId",
    async listChildren() {
      return "not-an-array";
    }
  });
  await assert.rejects(
    () =>
      hooks.afterQuery([{ id: 7 }], {
        state: {},
        callOptions: {}
      }),
    /listChildren must return an array/
  );
});

test("createHooksToCollectChildren requires ctx.state during afterQuery", async () => {
  const hooks = createHooksToCollectChildren({
    childKey: "pets",
    childOwnerIdKey: "contactId",
    async listChildren() {
      return [];
    }
  });

  await assert.rejects(
    () => hooks.afterQuery([{ id: 1 }], {}),
    /requires ctx\.state object/
  );
});
