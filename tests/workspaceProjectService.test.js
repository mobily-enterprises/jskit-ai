import assert from "node:assert/strict";
import test from "node:test";
import { createProjectsService } from "../services/workspace/projects.js";

function createWorkspaceContext(id = 11) {
  return {
    id
  };
}

test("projects service lists projects with safe pagination", async () => {
  const calls = [];
  const service = createProjectsService({
    projectsRepository: {
      async countForWorkspace(workspaceId) {
        calls.push(["countForWorkspace", workspaceId]);
        return 21;
      },
      async listForWorkspace(workspaceId, page, pageSize) {
        calls.push(["listForWorkspace", workspaceId, page, pageSize]);
        return [{ id: 1, workspaceId, page, pageSize }];
      }
    }
  });

  const result = await service.list(createWorkspaceContext(), {
    page: 99,
    pageSize: 10
  });

  assert.equal(result.page, 3);
  assert.equal(result.totalPages, 3);
  assert.equal(result.total, 21);
  assert.equal(result.entries.length, 1);
  assert.deepEqual(calls, [
    ["countForWorkspace", 11],
    ["listForWorkspace", 11, 3, 10]
  ]);
});

test("projects service creates, fetches, and updates projects", async () => {
  const calls = [];
  const service = createProjectsService({
    projectsRepository: {
      async countForWorkspace() {
        return 0;
      },
      async listForWorkspace() {
        return [];
      },
      async findByIdForWorkspace(workspaceId, projectId) {
        calls.push(["findByIdForWorkspace", workspaceId, projectId]);
        return {
          id: projectId,
          workspaceId,
          name: "Demo",
          status: "draft",
          owner: "",
          notes: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async insert(workspaceId, payload) {
        calls.push(["insert", workspaceId, payload]);
        return {
          id: 5,
          workspaceId,
          ...payload,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      },
      async updateByIdForWorkspace(workspaceId, projectId, patch) {
        calls.push(["updateByIdForWorkspace", workspaceId, projectId, patch]);
        return {
          id: projectId,
          workspaceId,
          name: patch.name || "Demo",
          status: patch.status || "draft",
          owner: patch.owner || "",
          notes: patch.notes || "",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
      }
    }
  });

  const created = await service.create(createWorkspaceContext(), {
    name: "Alpha",
    status: "active",
    owner: "Nora",
    notes: "Initial scope"
  });
  assert.equal(created.project.id, 5);
  assert.equal(created.project.status, "active");

  const fetched = await service.get(createWorkspaceContext(), "5");
  assert.equal(fetched.project.id, 5);

  const updated = await service.update(createWorkspaceContext(), "5", {
    name: "Alpha 2",
    notes: "Revised"
  });
  assert.equal(updated.project.id, 5);
  assert.equal(updated.project.name, "Alpha 2");

  assert.equal(calls.some((entry) => entry[0] === "insert"), true);
  assert.equal(calls.some((entry) => entry[0] === "findByIdForWorkspace"), true);
  assert.equal(calls.some((entry) => entry[0] === "updateByIdForWorkspace"), true);

  const replaced = await service.replace(createWorkspaceContext(), "5", {
    name: "Alpha Replace",
    status: "archived",
    owner: "Nora 2",
    notes: "Replaced"
  });
  assert.equal(replaced.project.id, 5);
  assert.equal(replaced.project.status, "archived");
});

test("projects service enforces validation and not found behavior", async () => {
  const service = createProjectsService({
    projectsRepository: {
      async countForWorkspace() {
        return 0;
      },
      async listForWorkspace() {
        return [];
      },
      async findByIdForWorkspace() {
        return null;
      },
      async insert() {
        throw new Error("insert should not be called");
      },
      async updateByIdForWorkspace() {
        return null;
      }
    }
  });

  await assert.rejects(
    () => service.create(createWorkspaceContext(), { name: "", status: "draft" }),
    (error) => {
      assert.equal(error.status, 400);
      return true;
    }
  );

  await assert.rejects(
    () => service.get(createWorkspaceContext(), "1"),
    (error) => {
      assert.equal(error.status, 404);
      return true;
    }
  );

  await assert.rejects(
    () => service.update(createWorkspaceContext(), "1", { name: "   " }),
    (error) => {
      assert.equal(error.status, 400);
      return true;
    }
  );

  await assert.rejects(
    () => service.update(createWorkspaceContext(), "1", { owner: "ok" }),
    (error) => {
      assert.equal(error.status, 404);
      return true;
    }
  );

  await assert.rejects(
    () => service.replace(createWorkspaceContext(), "1", { name: "x", status: "draft" }),
    (error) => {
      assert.equal(error.status, 404);
      return true;
    }
  );
});
