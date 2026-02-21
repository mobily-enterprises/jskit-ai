import assert from "node:assert/strict";
import test from "node:test";

import { createService as createConsoleService } from "../server/domain/console/services/console.service.js";

function createConsoleServiceHarness({ billingRepository, billingEnabled = true } = {}) {
  const activeMembership = {
    userId: 1,
    roleId: "devop",
    status: "active"
  };

  return createConsoleService({
    consoleMembershipsRepository: {
      async transaction(work) {
        return work(null);
      },
      async findByUserId(userId) {
        return Number(userId) === 1 ? activeMembership : null;
      },
      async countActiveMembers() {
        return 1;
      },
      async findActiveByRoleId() {
        return activeMembership;
      }
    },
    consoleInvitesRepository: {
      async transaction(work) {
        return work(null);
      },
      async listPendingByEmail() {
        return [];
      }
    },
    consoleRootRepository: {
      async findRootUserId() {
        return 1;
      },
      async assignRootUserIdIfUnset() {
        return 1;
      }
    },
    consoleSettingsRepository: {},
    userProfilesRepository: {},
    billingRepository,
    billingEnabled
  });
}

test("console billing events list does not cap deep-page fetch limit at 2000", async () => {
  const repositoryCalls = [];
  const service = createConsoleServiceHarness({
    billingRepository: {
      async listBillingActivityEvents(payload) {
        repositoryCalls.push(payload);
        return [];
      }
    }
  });

  const response = await service.listBillingEvents(
    {
      id: 1,
      email: "devop@example.test"
    },
    {
      page: 26,
      pageSize: 100,
      operationKey: "op_1"
    }
  );

  assert.equal(repositoryCalls.length, 1);
  assert.equal(repositoryCalls[0].limit, 2601);
  assert.equal(repositoryCalls[0].includeGlobal, true);
  assert.equal(repositoryCalls[0].operationKey, "op_1");
  assert.equal(response.entries.length, 0);
  assert.equal(response.hasMore, false);
});
