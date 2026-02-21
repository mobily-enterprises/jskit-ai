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

test("projects controller requires projects service", () => {
  assert.throws(() => createProjectsController({}), /required/);
});

test("projects controller delegates list/get/create/update/replace to projects service", async () => {
  const calls = [];
  const projectsService = {
    async list(workspaceContext, pagination) {
      calls.push(["list", workspaceContext.id, pagination.page, pagination.pageSize]);
      return {
        entries: [],
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: 0,
        totalPages: 1
      };
    },
    async get(workspaceContext, projectId) {
      calls.push(["get", workspaceContext.id, projectId]);
      return {
        project: {
          id: Number(projectId)
        }
      };
    },
    async create(workspaceContext, payload) {
      calls.push(["create", workspaceContext.id, payload.name]);
      return {
        project: {
          id: 101
        }
      };
    },
    async update(workspaceContext, projectId, payload) {
      calls.push(["update", workspaceContext.id, projectId, payload.name]);
      return {
        project: {
          id: Number(projectId)
        }
      };
    },
    async replace(workspaceContext, projectId, payload) {
      calls.push(["replace", workspaceContext.id, projectId, payload.name]);
      return {
        project: {
          id: Number(projectId)
        }
      };
    }
  };

  const controller = createProjectsController({ projectsService });
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
  assert.equal(createReply.payload.project.id, 101);

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
  assert.equal(updateReply.payload.project.id, 99);

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
  assert.equal(replaceReply.payload.project.id, 99);

  assert.equal(
    calls.some((entry) => entry[0] === "list"),
    true
  );
  assert.equal(
    calls.some((entry) => entry[0] === "update"),
    true
  );
});

test("projects controller routes create through billing limit enforcement when available", async () => {
  const calls = [];
  const controller = createProjectsController({
    projectsService: {
      async create(workspaceContext, payload) {
        calls.push(["create", workspaceContext.id, payload.name]);
        return {
          project: {
            id: 777
          }
        };
      }
    },
    billingService: {
      async enforceLimitAndRecordUsage(payload) {
        calls.push([
          "enforce",
          payload.capability,
          payload.usageEventKey,
          Number(payload?.metadataJson?.workspaceId || 0)
        ]);
        return payload.action();
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
        "idempotency-key": "idem_project_create_1"
      },
      body: {
        name: "Created via enforcement"
      }
    },
    reply
  );

  assert.equal(reply.statusCode, 200);
  assert.equal(reply.payload.project.id, 777);
  assert.deepEqual(calls, [
    ["enforce", "projects.create", "idem_project_create_1", 11],
    ["create", 11, "Created via enforcement"]
  ]);
});

test("projects controller publishes realtime events for successful create/update/replace writes", async () => {
  const publishCalls = [];
  const projectsService = {
    async create() {
      return {
        project: {
          id: 201
        }
      };
    },
    async update(workspaceContext, projectId) {
      void workspaceContext;
      return {
        project: {
          id: Number(projectId)
        }
      };
    },
    async replace(workspaceContext, projectId) {
      void workspaceContext;
      return {
        project: {
          id: Number(projectId)
        }
      };
    },
    async list() {
      return {
        entries: [],
        page: 1,
        pageSize: 10,
        total: 0,
        totalPages: 1
      };
    },
    async get(workspaceContext, projectId) {
      void workspaceContext;
      return {
        project: {
          id: Number(projectId)
        }
      };
    }
  };
  const realtimeEventsService = {
    publishProjectEvent(payload) {
      publishCalls.push(payload);
    }
  };
  const controller = createProjectsController({
    projectsService,
    realtimeEventsService
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

  const listReply = createReplyDouble();
  await controller.list(
    {
      ...requestContext,
      query: {
        page: "1",
        pageSize: "10"
      }
    },
    listReply
  );
  assert.equal(listReply.statusCode, 200);

  const getReply = createReplyDouble();
  await controller.get(
    {
      ...requestContext,
      params: {
        projectId: "203"
      }
    },
    getReply
  );
  assert.equal(getReply.statusCode, 200);

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
  const projectsService = {
    async create() {
      return {
        project: {
          id: 301
        }
      };
    }
  };
  const warnings = [];
  const realtimeEventsService = {
    publishProjectEvent() {
      throw new Error("publish failed");
    }
  };
  const controller = createProjectsController({
    projectsService,
    realtimeEventsService
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
