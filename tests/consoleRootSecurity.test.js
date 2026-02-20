import assert from "node:assert/strict";
import test from "node:test";

import { createService as createConsoleService } from "../server/domain/console/services/console.service.js";
import { __testables as rootRepositoryTestables } from "../server/domain/console/repositories/root.repository.js";

function createRootIdentityDbStub(initialRow = null) {
  const state = {
    row: initialRow ? { ...initialRow } : null
  };

  function matchesRow(filter, nullFilterColumn) {
    if (!state.row) {
      return false;
    }

    const normalizedFilter = filter && typeof filter === "object" ? filter : {};
    for (const [key, value] of Object.entries(normalizedFilter)) {
      if (state.row[key] !== value) {
        return false;
      }
    }

    if (nullFilterColumn && state.row[nullFilterColumn] != null) {
      return false;
    }

    return true;
  }

  function createWhereChain(initialFilter = {}) {
    let filter = { ...initialFilter };
    let nullFilterColumn = "";

    return {
      where(nextFilter) {
        const normalized = nextFilter && typeof nextFilter === "object" ? nextFilter : {};
        filter = {
          ...filter,
          ...normalized
        };
        return this;
      },
      whereNull(column) {
        nullFilterColumn = String(column || "");
        return this;
      },
      async first() {
        if (!matchesRow(filter, nullFilterColumn)) {
          return undefined;
        }

        return { ...state.row };
      },
      async update(payload) {
        if (!matchesRow(filter, nullFilterColumn)) {
          return 0;
        }

        state.row = {
          ...state.row,
          ...(payload && typeof payload === "object" ? payload : {})
        };
        return 1;
      }
    };
  }

  function dbClient(tableName) {
    assert.equal(tableName, "console_root_identity");

    return {
      async insert(payload) {
        if (state.row) {
          const duplicateError = new Error("Duplicate entry");
          duplicateError.code = "ER_DUP_ENTRY";
          throw duplicateError;
        }

        state.row = {
          ...(payload && typeof payload === "object" ? payload : {})
        };
      },
      where(filter) {
        return createWhereChain(filter);
      }
    };
  }

  return {
    dbClient,
    state
  };
}

function createConsoleServiceFixture({ rootUserId = null, memberships = [] } = {}) {
  const state = {
    rootUserId: rootUserId == null ? null : Number(rootUserId),
    consoleSettings: {
      id: 1,
      features: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    membershipsByUserId: new Map(
      memberships.map((membership, index) => [
        Number(membership.userId),
        {
          id: Number(membership.id || index + 1),
          userId: Number(membership.userId),
          roleId: String(membership.roleId || ""),
          status: String(membership.status || "active")
        }
      ])
    ),
    roleUpdates: []
  };

  const consoleMembershipsRepository = {
    async findByUserId(userId) {
      return state.membershipsByUserId.get(Number(userId)) || null;
    },
    async findActiveByRoleId(roleId) {
      const normalizedRoleId = String(roleId || "").trim().toLowerCase();
      for (const membership of state.membershipsByUserId.values()) {
        if (membership.status === "active" && String(membership.roleId || "").trim().toLowerCase() === normalizedRoleId) {
          return membership;
        }
      }

      return null;
    },
    async listActive() {
      return Array.from(state.membershipsByUserId.values())
        .filter((membership) => membership.status === "active")
        .map((membership) => ({
          ...membership,
          user: {
            id: membership.userId,
            email: `user-${membership.userId}@example.com`,
            displayName: `User ${membership.userId}`
          }
        }));
    },
    async countActiveMembers() {
      return Array.from(state.membershipsByUserId.values()).filter((membership) => membership.status === "active").length;
    },
    async insert(membership) {
      const nextMembership = {
        id: state.membershipsByUserId.size + 1,
        userId: Number(membership.userId),
        roleId: String(membership.roleId || ""),
        status: String(membership.status || "active")
      };
      state.membershipsByUserId.set(nextMembership.userId, nextMembership);
      return nextMembership;
    },
    async updateRoleByUserId(userId, roleId) {
      const numericUserId = Number(userId);
      const existing = state.membershipsByUserId.get(numericUserId);
      if (!existing) {
        return null;
      }

      existing.roleId = String(roleId || "").trim().toLowerCase();
      state.roleUpdates.push([numericUserId, existing.roleId]);
      return existing;
    },
    async ensureActiveByUserId(userId, roleId) {
      const numericUserId = Number(userId);
      const existing = state.membershipsByUserId.get(numericUserId);
      if (!existing) {
        const created = {
          id: state.membershipsByUserId.size + 1,
          userId: numericUserId,
          roleId: String(roleId || "").trim().toLowerCase(),
          status: "active"
        };
        state.membershipsByUserId.set(numericUserId, created);
        return created;
      }

      existing.roleId = String(roleId || "").trim().toLowerCase();
      existing.status = "active";
      return existing;
    },
    async transaction(work) {
      return work(null);
    }
  };

  const consoleInvitesRepository = {
    async listPendingByEmail() {
      return [];
    },
    async listPending() {
      return [];
    },
    async expirePendingByEmail() {
      return 0;
    },
    async insert() {
      return null;
    },
    async findPendingById() {
      return null;
    },
    async findPendingByTokenHash() {
      return null;
    },
    async revokeById() {
      return null;
    },
    async markAcceptedById() {
      return null;
    },
    async transaction(work) {
      return work(null);
    }
  };

  const consoleRootRepository = {
    async findRootUserId() {
      return state.rootUserId;
    },
    async assignRootUserIdIfUnset(userId) {
      const numericUserId = Number(userId);
      if (!Number.isInteger(numericUserId) || numericUserId < 1) {
        return state.rootUserId;
      }

      if (!state.rootUserId) {
        state.rootUserId = numericUserId;
      }

      return state.rootUserId;
    }
  };

  const consoleSettingsRepository = {
    async ensure() {
      return {
        ...state.consoleSettings,
        features: { ...(state.consoleSettings.features || {}) }
      };
    },
    async update(patch = {}) {
      state.consoleSettings = {
        ...state.consoleSettings,
        ...(patch && typeof patch === "object" ? patch : {}),
        features:
          patch && typeof patch.features === "object" ? { ...patch.features } : { ...(state.consoleSettings.features || {}) },
        updatedAt: new Date().toISOString()
      };
      return {
        ...state.consoleSettings,
        features: { ...(state.consoleSettings.features || {}) }
      };
    }
  };

  const userProfilesRepository = {
    async findByEmail() {
      return null;
    }
  };

  return {
    state,
    service: createConsoleService({
      consoleMembershipsRepository,
      consoleInvitesRepository,
      consoleRootRepository,
      consoleSettingsRepository,
      userProfilesRepository
    })
  };
}

test("console root repository tracks root id once and keeps it immutable by assign-if-empty writes", async () => {
  const { dbClient, state } = createRootIdentityDbStub();
  const repository = rootRepositoryTestables.createRootIdentityRepository(dbClient);

  assert.equal(await repository.findRootUserId(), null);
  assert.equal(await repository.assignRootUserIdIfUnset(41), 41);
  assert.equal(await repository.assignRootUserIdIfUnset(99), 41);
  assert.equal(await repository.assignRootUserIdIfUnset(""), 41);
  assert.equal(state.row.user_id, 41);

  assert.equal(rootRepositoryTestables.mapRootIdentityRowNullable(null), null);
  assert.throws(() => rootRepositoryTestables.mapRootIdentityRowRequired(null), /expected a row object/);
});

test("console service seeds root user from first active console membership", async () => {
  const fixture = createConsoleServiceFixture({
    memberships: [
      {
        userId: 7,
        roleId: "console",
        status: "active"
      }
    ]
  });

  await fixture.service.ensureInitialConsoleMember(42);

  assert.equal(fixture.state.rootUserId, 7);
  assert.equal(fixture.state.membershipsByUserId.has(42), false);
});

test("console service seeds root user from first authenticated bootstrap when no members exist", async () => {
  const fixture = createConsoleServiceFixture();

  await fixture.service.ensureInitialConsoleMember(5);

  assert.equal(fixture.state.rootUserId, 5);
  const createdMembership = fixture.state.membershipsByUserId.get(5);
  assert.equal(createdMembership.roleId, "console");
  assert.equal(createdMembership.status, "active");
});

test("console service blocks non-root user from modifying root member", async () => {
  const fixture = createConsoleServiceFixture({
    rootUserId: 1,
    memberships: [
      {
        userId: 1,
        roleId: "console",
        status: "active"
      },
      {
        userId: 2,
        roleId: "console",
        status: "active"
      }
    ]
  });

  await assert.rejects(
    () =>
      fixture.service.updateMemberRole(
        {
          id: 2,
          email: "actor@example.com"
        },
        {
          memberUserId: 1,
          roleId: "devop"
        }
      ),
    (error) => {
      assert.equal(error.status, 403);
      assert.equal(String(error.message || "").includes("Only root can"), true);
      return true;
    }
  );
  assert.equal(fixture.state.roleUpdates.length, 0);
});

test("console service allows root to manage non-root members and keeps root role immutable", async () => {
  const fixture = createConsoleServiceFixture({
    rootUserId: 1,
    memberships: [
      {
        userId: 1,
        roleId: "console",
        status: "active"
      },
      {
        userId: 9,
        roleId: "moderator",
        status: "active"
      }
    ]
  });

  const updated = await fixture.service.updateMemberRole(
    {
      id: 1,
      email: "root@example.com"
    },
    {
      memberUserId: 9,
      roleId: "devop"
    }
  );
  assert.equal(updated.members.some((member) => member.userId === 9 && member.roleId === "devop"), true);
  assert.deepEqual(fixture.state.roleUpdates, [[9, "devop"]]);

  await assert.rejects(
    () =>
      fixture.service.updateMemberRole(
        {
          id: 1,
          email: "root@example.com"
        },
        {
          memberUserId: 1,
          roleId: "devop"
        }
      ),
    (error) => {
      assert.equal(error.status, 409);
      return true;
    }
  );
});

test("console service exposes assistant settings to console members and restricts updates to managers", async () => {
  const fixture = createConsoleServiceFixture({
    rootUserId: 1,
    memberships: [
      {
        userId: 1,
        roleId: "console",
        status: "active"
      },
      {
        userId: 2,
        roleId: "devop",
        status: "active"
      }
    ]
  });

  const initialSettings = await fixture.service.getAssistantSettings({
    id: 2,
    email: "devop@example.com"
  });
  assert.equal(initialSettings.settings.assistantSystemPromptWorkspace, "");

  await assert.rejects(
    () =>
      fixture.service.updateAssistantSettings(
        {
          id: 2,
          email: "devop@example.com"
        },
        {
          assistantSystemPromptWorkspace: "Use concise language."
        }
      ),
    (error) => {
      assert.equal(error.status, 403);
      return true;
    }
  );

  const updatedSettings = await fixture.service.updateAssistantSettings(
    {
      id: 1,
      email: "console@example.com"
    },
    {
      assistantSystemPromptWorkspace: "Use concise language."
    }
  );
  assert.equal(updatedSettings.settings.assistantSystemPromptWorkspace, "Use concise language.");

  const persistedSettings = await fixture.service.getAssistantSettings({
    id: 1,
    email: "console@example.com"
  });
  assert.equal(persistedSettings.settings.assistantSystemPromptWorkspace, "Use concise language.");
});
