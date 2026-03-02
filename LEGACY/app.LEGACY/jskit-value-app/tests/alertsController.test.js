import assert from "node:assert/strict";
import test from "node:test";

import { createController } from "../server/modules/alerts/controller.js";
import { ACTION_IDS } from "../shared/actionIds.js";
import { createReplyDouble } from "./helpers/replyDouble.js";

test("alerts controller requires actionExecutor.execute", () => {
  assert.throws(() => createController({}), /required/);
});

test("alerts controller delegates list and read-all through action executor", async () => {
  const calls = [];
  const controller = createController({
    actionExecutor: {
      async execute(payload) {
        calls.push(payload);

        if (payload.actionId === ACTION_IDS.SETTINGS_ALERTS_LIST) {
          return {
            entries: [],
            page: 1,
            pageSize: 20,
            total: 0,
            totalPages: 1,
            unreadCount: 0,
            readThroughAlertId: null
          };
        }

        return {
          unreadCount: 0,
          readThroughAlertId: 22
        };
      }
    }
  });

  const listReply = createReplyDouble();
  await controller.list(
    {
      query: {
        page: "2",
        pageSize: "10"
      },
      user: {
        id: 7
      }
    },
    listReply
  );
  assert.equal(listReply.statusCode, 200);
  assert.equal(listReply.payload.pageSize, 20);

  const readAllReply = createReplyDouble();
  await controller.markAllRead(
    {
      user: {
        id: 7
      }
    },
    readAllReply
  );
  assert.equal(readAllReply.statusCode, 200);
  assert.equal(readAllReply.payload.readThroughAlertId, 22);

  assert.deepEqual(
    calls.map((entry) => entry.actionId),
    [ACTION_IDS.SETTINGS_ALERTS_LIST, ACTION_IDS.SETTINGS_ALERTS_READ_ALL]
  );
  assert.equal(calls[0].context.channel, "api");
  assert.deepEqual(calls[0].input, { page: "2", pageSize: "10" });
  assert.deepEqual(calls[1].input, {});
});
