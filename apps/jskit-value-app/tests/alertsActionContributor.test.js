import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_IDS } from "../shared/actionIds.js";
import { createAlertsActionContributor } from "../server/runtime/actions/contributors/alerts.contributor.js";

function getAction(contributor, actionId) {
  return contributor.actions.find((action) => action.id === actionId);
}

test("alerts list action ignores payload.user and resolves user from request context", async () => {
  const calls = [];
  const contributor = createAlertsActionContributor({
    alertsService: {
      async listForUser(user, pagination) {
        calls.push({
          user,
          pagination
        });
        return {
          entries: [],
          page: pagination.page,
          pageSize: pagination.pageSize,
          total: 0,
          totalPages: 1,
          unreadCount: 0,
          readThroughAlertId: null
        };
      },
      async markAllReadForUser() {
        return {
          unreadCount: 0,
          readThroughAlertId: null
        };
      }
    }
  });

  const listAction = getAction(contributor, ACTION_IDS.SETTINGS_ALERTS_LIST);
  await listAction.execute(
    {
      user: {
        id: 999
      },
      page: 3,
      pageSize: 30
    },
    {
      actor: {
        id: 5
      },
      requestMeta: {
        request: {
          user: {
            id: 11
          }
        }
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].user.id, 11);
  assert.deepEqual(calls[0].pagination, {
    page: 3,
    pageSize: 30
  });
});

test("alerts read-all action resolves user from actor when request user is unavailable", async () => {
  const calls = [];
  const contributor = createAlertsActionContributor({
    alertsService: {
      async listForUser() {
        return {
          entries: [],
          page: 1,
          pageSize: 20,
          total: 0,
          totalPages: 1,
          unreadCount: 0,
          readThroughAlertId: null
        };
      },
      async markAllReadForUser(user) {
        calls.push(user);
        return {
          unreadCount: 0,
          readThroughAlertId: 10
        };
      }
    }
  });

  const readAllAction = getAction(contributor, ACTION_IDS.SETTINGS_ALERTS_READ_ALL);
  await readAllAction.execute(
    {
      user: {
        id: 777
      }
    },
    {
      actor: {
        id: 42
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 42);
});
