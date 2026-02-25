import assert from "node:assert/strict";
import test from "node:test";

import { createController as createProjectsController } from "../server/modules/projects/controller.js";

function createReplyDouble() {
  return {
    statusCode: null,
    payload: null,
    code(status) {
      this.statusCode = status;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    }
  };
}

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

test("projects controller publishes realtime events for successful create/update/replace writes", async () => {
  const publishCalls = [];
  const controller = createProjectsController({
    actionExecutor: {
      async execute({ actionId, input }) {
        if (actionId === "projects.create") {
          return {
            project: {
              id: 201
            }
          };
        }
        if (actionId === "projects.update") {
          return {
            project: {
              id: Number(input.projectId)
            }
          };
        }
        if (actionId === "projects.list") {
          return {
            entries: [],
            page: 1,
            pageSize: 10,
            total: 0,
            totalPages: 1
          };
        }
        if (actionId === "projects.get") {
          return {
            project: {
              id: Number(input.projectId)
            }
          };
        }
        throw new Error(`Unexpected action: ${actionId}`);
      }
    },
    realtimeEventsService: {
      publishProjectEvent(payload) {
        publishCalls.push(payload);
      }
    }
  });

  const workspace = {
    id: 11,
    slug: "acme"
  };
  const requestContext = {
    workspace,
    user: {
      id: 7
    },
    headers: {
      "x-command-id": "cmd_a",
      "x-client-id": "cli_a"
    }
  };

  const createReply = createReplyDouble();
  await controller.create(
    {
      ...requestContext,
      body: {
        name: "Created"
      }
    },
    createReply
  );
  assert.equal(createReply.statusCode, 200);

  const updateReply = createReplyDouble();
  await controller.update(
    {
      ...requestContext,
      params: {
        projectId: "202"
      },
      body: {
        name: "Updated"
      }
    },
    updateReply
  );
  assert.equal(updateReply.statusCode, 200);

  const replaceReply = createReplyDouble();
  await controller.replace(
    {
      ...requestContext,
      params: {
        projectId: "203"
      },
      body: {
        name: "Replaced"
      }
    },
    replaceReply
  );
  assert.equal(replaceReply.statusCode, 200);

  assert.equal(publishCalls.length, 3);
  assert.deepEqual(
    publishCalls.map((entry) => entry.operation),
    ["created", "updated", "updated"]
  );
  assert.deepEqual(
    publishCalls.map((entry) => entry.commandId),
    ["cmd_a", "cmd_a", "cmd_a"]
  );
  assert.deepEqual(
    publishCalls.map((entry) => entry.sourceClientId),
    ["cli_a", "cli_a", "cli_a"]
  );
  assert.deepEqual(
    publishCalls.map((entry) => entry.actorUserId),
    [7, 7, 7]
  );
});

test("projects controller keeps successful write responses when realtime publish fails", async () => {
  const warnings = [];
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
        throw new Error("publish failed");
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
      },
      log: {
        warn(payload, message) {
          warnings.push({ payload, message });
        }
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.project.id, 301);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, "projects.realtime.publish_failed");
});
