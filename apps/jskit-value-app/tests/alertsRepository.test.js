import assert from "node:assert/strict";
import test from "node:test";

import { __testables } from "../server/modules/alerts/repository.js";

function createAlertsDbStub() {
  const state = {
    nextAlertId: 1,
    userAlerts: [],
    userAlertStates: [],
    transactionCalls: 0
  };

  function applyFilters(rows, filters = [], andWhereFilter = null) {
    let nextRows = rows.slice();

    for (const filter of filters) {
      const normalized = filter && typeof filter === "object" ? filter : {};
      nextRows = nextRows.filter((row) =>
        Object.entries(normalized).every(([key, value]) => {
          return row[key] === value;
        })
      );
    }

    if (andWhereFilter && andWhereFilter.operator === ">" && andWhereFilter.column) {
      nextRows = nextRows.filter((row) => Number(row[andWhereFilter.column]) > Number(andWhereFilter.value));
    }

    return nextRows;
  }

  function resolveRows(tableName, queryState) {
    const sourceRows = tableName === "user_alerts" ? state.userAlerts : state.userAlertStates;
    let rows = applyFilters(sourceRows, queryState.filters, queryState.andWhereFilter);

    if (queryState.orderBy) {
      const [column, direction] = queryState.orderBy;
      const orderDirection = String(direction || "asc").toLowerCase();
      rows.sort((left, right) => {
        const leftValue = left[column];
        const rightValue = right[column];
        if (leftValue === rightValue) {
          return 0;
        }
        if (orderDirection === "desc") {
          return leftValue > rightValue ? -1 : 1;
        }
        return leftValue > rightValue ? 1 : -1;
      });
    }

    const offset = Math.max(0, Number(queryState.offset) || 0);
    const limit = Math.max(0, Number(queryState.limit) || 0);
    if (limit > 0) {
      rows = rows.slice(offset, offset + limit);
    }

    return rows;
  }

  function createQuery(tableName) {
    const queryState = {
      filters: [],
      andWhereFilter: null,
      orderBy: null,
      limit: 0,
      offset: 0,
      countAlias: "",
      maxAlias: "",
      maxColumn: ""
    };

    return {
      insert(payload) {
        const row = payload && typeof payload === "object" ? { ...payload } : {};

        if (tableName === "user_alerts") {
          const id = state.nextAlertId++;
          state.userAlerts.push({
            id,
            ...row
          });
          return Promise.resolve([id]);
        }

        if (tableName === "user_alert_states") {
          return {
            onConflict() {
              return {
                merge(mergePayload) {
                  const userId = Number(row.user_id);
                  const existingIndex = state.userAlertStates.findIndex(
                    (entry) => Number(entry.user_id) === userId
                  );
                  if (existingIndex >= 0) {
                    state.userAlertStates[existingIndex] = {
                      ...state.userAlertStates[existingIndex],
                      ...(mergePayload && typeof mergePayload === "object" ? mergePayload : {})
                    };
                  } else {
                    state.userAlertStates.push({
                      ...row
                    });
                  }

                  return Promise.resolve();
                }
              };
            }
          };
        }

        return Promise.resolve([]);
      },
      where(filter) {
        queryState.filters.push(filter && typeof filter === "object" ? { ...filter } : {});
        return this;
      },
      andWhere(column, operator, value) {
        queryState.andWhereFilter = {
          column: String(column || ""),
          operator: String(operator || ""),
          value
        };
        return this;
      },
      orderBy(column, direction) {
        queryState.orderBy = [String(column || ""), String(direction || "asc")];
        return this;
      },
      limit(value) {
        queryState.limit = Number(value) || 0;
        return this;
      },
      offset(value) {
        queryState.offset = Number(value) || 0;
        return Promise.resolve(resolveRows(tableName, queryState));
      },
      count(aliasMap) {
        queryState.countAlias = Object.keys(aliasMap || {})[0] || "total";
        return this;
      },
      max(aliasMap) {
        queryState.maxAlias = Object.keys(aliasMap || {})[0] || "max";
        queryState.maxColumn = aliasMap?.[queryState.maxAlias] || "id";
        return this;
      },
      first() {
        const rows = resolveRows(tableName, queryState);

        if (queryState.countAlias) {
          return Promise.resolve({
            [queryState.countAlias]: rows.length
          });
        }

        if (queryState.maxAlias) {
          const values = rows
            .map((row) => Number(row[queryState.maxColumn]))
            .filter((value) => Number.isFinite(value) && value > 0);
          return Promise.resolve({
            [queryState.maxAlias]: values.length > 0 ? Math.max(...values) : null
          });
        }

        return Promise.resolve(rows[0]);
      }
    };
  }

  function dbClient(tableName) {
    return createQuery(tableName);
  }

  dbClient.transaction = async (work) => {
    state.transactionCalls += 1;
    return work(dbClient);
  };

  return {
    dbClient,
    state
  };
}

test("alerts repository helper functions normalize counts/ids/payload and mappers", () => {
  assert.equal(__testables.normalizeCount({ total: "3" }), 3);
  assert.equal(__testables.normalizeCount({}), 0);
  assert.equal(__testables.normalizeCount({ total: "-2" }), 0);
  assert.equal(__testables.normalizePositiveInteger("7"), 7);
  assert.equal(__testables.normalizePositiveInteger("0"), null);

  assert.deepEqual(__testables.parsePayloadJson('{"ok":true}'), { ok: true });
  assert.equal(__testables.parsePayloadJson("not-json"), null);
  assert.equal(__testables.parsePayloadJson(null), null);

  assert.throws(() => __testables.mapAlertRowRequired(null), /expected a row object/);
  assert.throws(() => __testables.mapReadStateRowRequired(null), /expected a row object/);
  assert.equal(__testables.mapReadStateRowNullable(null), null);
});

test("alerts repository insert/list/count/read-state flow works with factory contract", async () => {
  const { dbClient, state } = createAlertsDbStub();
  const repository = __testables.createAlertsRepository(dbClient);

  const first = await repository.insertAlert({
    userId: 8,
    type: "workspace.invite.received",
    title: "Workspace invite",
    message: "You were invited.",
    targetUrl: "/workspaces",
    payloadJson: { workspaceId: 11 },
    actorUserId: 2,
    workspaceId: 11,
    createdAt: "2026-02-25T00:00:00.000Z"
  });
  const second = await repository.insertAlert({
    userId: 8,
    type: "console.invite.received",
    title: "Console invite",
    message: "You were invited to console.",
    targetUrl: "/console/invitations",
    payloadJson: { roleId: "member" },
    actorUserId: null,
    workspaceId: null,
    createdAt: "2026-02-25T00:01:00.000Z"
  });

  assert.equal(first.id, 1);
  assert.equal(second.id, 2);

  const listPageOne = await repository.listAlertsForUser(8, 1, 20);
  assert.equal(listPageOne.length, 2);
  assert.equal(listPageOne[0].id, 2);
  assert.equal(listPageOne[1].id, 1);

  const totalCount = await repository.countAlertsForUser(8);
  assert.equal(totalCount, 2);

  const unreadBeforeReadState = await repository.countUnreadAlertsForUser(8, null);
  assert.equal(unreadBeforeReadState, 2);

  assert.equal(await repository.getLatestAlertIdForUser(8), 2);
  assert.equal(await repository.getReadStateForUser(8), null);

  const insertedReadState = await repository.upsertReadStateForUser(8, 1);
  assert.equal(insertedReadState.readThroughAlertId, 1);

  const unreadAfterReadState = await repository.countUnreadAlertsForUser(8, insertedReadState.readThroughAlertId);
  assert.equal(unreadAfterReadState, 1);

  const updatedReadState = await repository.upsertReadStateForUser(8, 2);
  assert.equal(updatedReadState.readThroughAlertId, 2);
  assert.equal(state.userAlertStates.length, 1);
});

test("alerts repository transaction delegates to db.transaction", async () => {
  const { dbClient, state } = createAlertsDbStub();
  const repository = __testables.createAlertsRepository(dbClient);

  const value = await repository.transaction(async () => {
    return "ok";
  });

  assert.equal(value, "ok");
  assert.equal(state.transactionCalls, 1);
});

