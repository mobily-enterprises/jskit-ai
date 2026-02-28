import assert from "node:assert/strict";
import test from "node:test";

import { createController as createProjectsController } from "../server/modules/projects/controller.js";
import { createReplyDouble } from "./helpers/replyDouble.js";

test("projects controller requires action executor", () => {
  assert.throws(() => createProjectsController({}), /required/);
});

test("projects controller delegates list/get/create/update/replace to project actions", async () => {
  const calls = [];
  const controller = createProjectsController({
    actionExecutor: {
      async execute({ actionId, input, context }) {
        calls.push({
          actionId,
          input,
          context
        });
        if (actionId === "projects.list") {
          return {
            entries: [],
            page: 2,
            pageSize: 25,
            total: 0,
            totalPages: 1
          };
        }
        return {
          project: {
            id: 99
          }
        };
      }
    }
  });

  const workspace = { id: 11, slug: "acme" };

  const listReply = createReplyDouble();
  await controller.list(
    {
      workspace,
      query: {
        page: "2",
        pageSize: "25"
      }
    },
    listReply
  );
  assert.equal(listReply.statusCode, 200);
  assert.equal(listReply.payload.page, 2);
  assert.equal(listReply.payload.pageSize, 25);

  const getReply = createReplyDouble();
  await controller.get(
    {
      workspace,
      params: {
        projectId: "99"
      }
    },
    getReply
  );
  assert.equal(getReply.statusCode, 200);
  assert.equal(getReply.payload.project.id, 99);

  const createReply = createReplyDouble();
  await controller.create(
    {
      workspace,
      body: {
        name: "New project"
      }
    },
    createReply
  );
  assert.equal(createReply.statusCode, 200);

  const updateReply = createReplyDouble();
  await controller.update(
    {
      workspace,
      params: {
        projectId: "99"
      },
      body: {
        name: "Updated project"
      }
    },
    updateReply
  );
  assert.equal(updateReply.statusCode, 200);

  const replaceReply = createReplyDouble();
  await controller.replace(
    {
      workspace,
      params: {
        projectId: "99"
      },
      body: {
        name: "Replacement project"
      }
    },
    replaceReply
  );
  assert.equal(replaceReply.statusCode, 200);

  assert.deepEqual(
    calls.map((entry) => entry.actionId),
    ["projects.list", "projects.get", "projects.create", "projects.update", "projects.update"]
  );
  assert.equal(calls[4].input.mode, "replace");
  assert.equal(calls.every((entry) => entry.context.channel === "api"), true);
});

test("projects controller remains transport-focused even when realtime service is provided", async () => {
  const controller = createProjectsController({
    actionExecutor: {
      async execute({ actionId }) {
        assert.equal(actionId, "projects.create");
        return {
          project: {
            id: 301
          }
        };
      }
    },
    realtimeEventsService: {
      publishProjectEvent() {
        throw new Error("should not be called by controller");
      }
    }
  });

  const reply = createReplyDouble();
  await controller.create(
    {
      workspace: {
        id: 11,
        slug: "acme"
      },
      user: {
        id: 7
      },
      headers: {
        "x-command-id": "cmd_b",
        "x-client-id": "cli_b"
      },
      body: {
        name: "Created"
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.project.id, 301);
});
