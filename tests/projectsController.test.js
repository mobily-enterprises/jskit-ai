import assert from "node:assert/strict";
import test from "node:test";

import { createProjectsController } from "../controllers/workspace/projects.js";

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
