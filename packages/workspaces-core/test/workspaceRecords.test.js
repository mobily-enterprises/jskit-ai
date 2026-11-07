import assert from "node:assert/strict";
import test from "node:test";
import { toIsoString } from "@jskit-ai/database-runtime/shared";
import { createRepository as createMembershipsRepository } from "../src/server/common/repositories/workspaceMembershipsRepository.js";
import { createRepository as createWorkspacesRepository } from "../src/server/common/repositories/workspacesRepository.js";

// The record logic the repositories add over their table handles, on handle stubs that record each call.
// repositories.integration.test.js and the *.mysql.test.js files read and write the real tables.

test("ensureOwnerMembership makes an existing membership an active owner by a patch and answers the stored record", async () => {
  const stored = {
    id: "11", workspaceId: "7", userId: "9", roleSid: "member", status: "pending",
    createdAt: "2026-03-09 00:26:35.710", updatedAt: "2026-03-09 00:26:35.710"
  };
  const patches = [];
  const repository = createMembershipsRepository({
    workspaceMemberships: {
      async queryAll({ filters }) {
        assert.deepEqual(filters, { workspace: "7", user: "9" });
        return [{ ...stored }];
      },
      async create() { throw new Error("An existing membership is patched, not created"); },
      async patch(id, changes, options) {
        assert.equal(options.returning, "none");
        patches.push({ id, changes });
        Object.assign(stored, changes);
        return null;
      }
    }
  });

  const membership = await repository.ensureOwnerMembership("7", "9");

  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, "11");
  assert.equal(patches[0].changes.roleSid, "owner");
  assert.equal(patches[0].changes.status, "active");
  assert.equal(typeof patches[0].changes.updatedAt, "string");
  assert.deepEqual(membership, {
    id: "11",
    workspaceId: "7",
    userId: "9",
    roleSid: "owner",
    status: "active",
    createdAt: toIsoString("2026-03-09 00:26:35.710"),
    updatedAt: toIsoString(patches[0].changes.updatedAt)
  });
  await repository.ensureOwnerMembership("7", "9");
  assert.equal(patches.length, 1, "An active owner is left as it is");
});

test("listActiveWorkspaceIdsByUserIds reads 1,000 users per query without including workspaces", async () => {
  const queryCalls = [];
  const repository = createMembershipsRepository({
    workspaceMemberships: {
      async queryAll(params) {
        queryCalls.push(params);
        // Every asked user is active in workspace 7, and user 1 in workspace 8 too.
        return params.filters.users.flatMap((userId) => [
          { id: `m${userId}`, workspaceId: "7", userId, status: "active" },
          ...(userId === "1" ? [{ id: "m1-8", workspaceId: "8", userId: "1", status: "active" }] : [])
        ]);
      }
    }
  });
  const userIds = Array.from({ length: 1001 }, (_, index) => String(index + 1));

  const workspaceIds = await repository.listActiveWorkspaceIdsByUserIds([...userIds, "1", "", null]);

  assert.equal(workspaceIds.size, 1001);
  assert.deepEqual(workspaceIds.get("1"), ["7", "8"]);
  assert.deepEqual(workspaceIds.get("1001"), ["7"]);
  assert.deepEqual(queryCalls.map(({ filters }) => filters.users.length), [1000, 1]);
  assert.deepEqual(queryCalls[1], { filters: { users: ["1001"], status: "active" } });
  assert.deepEqual(await repository.listActiveWorkspaceIdsByUserIds([]), new Map());
  assert.equal(queryCalls.length, 2, "No users need no query");
});

test("findPersonalByOwnerUserId answers the owner's personal workspace with the lowest id", async () => {
  const workspace = (id) => ({ id, slug: `personal-${id}`, name: "Personal", ownerUserId: "9", isPersonal: true });
  const repository = createWorkspacesRepository({
    workspaces: {
      async queryAll({ filters }) {
        assert.deepEqual(filters, { owner: "9", isPersonal: true });
        return [workspace("12"), workspace("3"), workspace("10")];
      }
    },
    workspaceMemberships: {}
  });

  assert.equal((await repository.findPersonalByOwnerUserId("9")).id, "3");
  assert.equal(await repository.findPersonalByOwnerUserId(""), null);
});

test("listForUserId answers a user's live workspaces with their membership, personal first, then by id", async () => {
  const membership = (id, roleSid, workspace) => ({ id, roleSid, status: "active", workspaceId: workspace.id, workspace });
  const repository = createWorkspacesRepository({
    workspaces: {},
    workspaceMemberships: {
      async queryAll(params) {
        assert.deepEqual(params, { filters: { user: "9", status: "active" }, include: ["workspace"] });
        return [
          membership("1", "admin", { id: "20", slug: "team", name: "Team", ownerUserId: "4", isPersonal: false }),
          membership("2", "owner", { id: "30", slug: "mine", name: "Mine", ownerUserId: "9", isPersonal: true }),
          membership("3", "member", { id: "5", slug: "gone", name: "Gone", ownerUserId: "4", deletedAt: "2026-01-01 00:00:00" }),
          membership("4", "member", { id: "8", slug: "early", name: "Early", ownerUserId: "4", isPersonal: false })
        ];
      }
    }
  });

  const listed = await repository.listForUserId("9");

  assert.deepEqual(listed.map(({ id, roleSid, membershipStatus }) => [id, roleSid, membershipStatus]), [
    ["30", "owner", "active"],
    ["8", "member", "active"],
    ["20", "admin", "active"]
  ]);
  assert.equal(listed[0].ownerUserId, "9");
  assert.deepEqual(await repository.listForUserId(null), []);
});

test("updateById stamps updatedAt and writes ownerUserId as an id", async () => {
  const patches = [];
  const repository = createWorkspacesRepository({
    workspaces: {
      async patch(id, changes) {
        patches.push({ id, changes });
        return { id, slug: "team", name: changes.name, ownerUserId: changes.ownerUserId, isPersonal: false };
      }
    },
    workspaceMemberships: {}
  });

  const updated = await repository.updateById(" 7 ", { name: "Renamed", ownerUserId: 12 });

  assert.equal(patches[0].id, "7");
  assert.equal(patches[0].changes.ownerUserId, "12");
  assert.equal(typeof patches[0].changes.updatedAt, "string");
  assert.equal(updated.ownerUserId, "12");
  assert.equal(await repository.updateById("", { name: "Nobody" }), null);
});
