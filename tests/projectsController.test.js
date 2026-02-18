import assert from "node:assert/strict";
import test from "node:test";

import { createProjectsController } from "../controllers/projectsController.js";

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

test("projects controller requires workspace project service", () => {
  assert.throws(() => createProjectsController({}), /required/);
});

test("projects controller delegates list/get/create/update to workspace project service", async () => {
  const calls = [];
  const workspaceProjectService = {
    async listProjects(workspaceContext, pagination) {
      calls.push(["listProjects", workspaceContext.id, pagination.page, pagination.pageSize]);
      return {
        entries: [],
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: 0,
        totalPages: 1
      };
    },
    async getProject(workspaceContext, projectId) {
      calls.push(["getProject", workspaceContext.id, projectId]);
      return {
        project: {
          id: Number(projectId)
        }
      };
    },
    async createProject(workspaceContext, payload) {
      calls.push(["createProject", workspaceContext.id, payload.name]);
      return {
        project: {
          id: 101
        }
      };
    },
    async updateProject(workspaceContext, projectId, payload) {
      calls.push(["updateProject", workspaceContext.id, projectId, payload.name]);
      return {
        project: {
          id: Number(projectId)
        }
      };
    }
  };

  const controller = createProjectsController({ workspaceProjectService });
  const workspace = { id: 11, slug: "acme" };

  const listReply = createReplyDouble();
  await controller.listWorkspaceProjects(
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
  await controller.getWorkspaceProject(
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
  await controller.createWorkspaceProject(
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
  await controller.updateWorkspaceProject(
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

  assert.equal(
    calls.some((entry) => entry[0] === "listProjects"),
    true
  );
  assert.equal(
    calls.some((entry) => entry[0] === "updateProject"),
    true
  );
});
