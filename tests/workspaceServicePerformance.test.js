import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceService } from "../services/workspaceService.js";

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createAsyncLimiter(maxConcurrent = 8) {
  let activeCount = 0;
  const queue = [];

  async function run(task) {
    if (activeCount >= maxConcurrent) {
      await new Promise((resolve) => {
        queue.push(resolve);
      });
    }

    activeCount += 1;
    try {
      return await task();
    } finally {
      activeCount -= 1;
      const next = queue.shift();
      if (next) {
        next();
      }
    }
  }

  return {
    run
  };
}

function normalizeWorkspaceIds(workspaceIds) {
  return Array.from(
    new Set(
      (Array.isArray(workspaceIds) ? workspaceIds : [])
        .map((workspaceId) => Number(workspaceId))
        .filter((workspaceId) => Number.isInteger(workspaceId) && workspaceId > 0)
    )
  );
}

function buildWorkspaceMemberships(workspaceCount) {
  return Array.from({ length: workspaceCount }, (_, index) => {
    const workspaceId = index + 1;
    return {
      id: workspaceId,
      slug: `workspace-${workspaceId}`,
      name: `Workspace ${workspaceId}`,
      color: "#0F6B54",
      avatarUrl: "",
      ownerUserId: 1,
      isPersonal: false,
      roleId: "member",
      membershipStatus: "active"
    };
  });
}

function buildWorkspaceSettingsLookup(workspaceCount) {
  const workspaceSettingsById = new Map();
  for (let workspaceId = 1; workspaceId <= workspaceCount; workspaceId += 1) {
    workspaceSettingsById.set(workspaceId, {
      workspaceId,
      invitesEnabled: true,
      features: {},
      policy: {}
    });
  }
  return workspaceSettingsById;
}

function createPerformanceFixture({
  workspaceCount = 120,
  queryDelayMs = 2,
  queryConcurrency = 8,
  supportsBatchSettingsFetch = false
} = {}) {
  const userId = 7001;
  const user = {
    id: userId,
    displayName: "Perf",
    email: "perf@example.com"
  };
  const memberships = buildWorkspaceMemberships(workspaceCount);
  const workspaceSettingsById = buildWorkspaceSettingsLookup(workspaceCount);
  const limiter = createAsyncLimiter(queryConcurrency);
  const calls = {
    findWorkspaceSettingsByWorkspaceIds: 0,
    ensureWorkspaceSettings: 0
  };

  const workspaceSettingsRepository = {
    async ensureForWorkspaceId(workspaceId) {
      calls.ensureWorkspaceSettings += 1;
      return limiter.run(async () => {
        await sleep(queryDelayMs);
        return workspaceSettingsById.get(Number(workspaceId)) || null;
      });
    }
  };

  if (supportsBatchSettingsFetch) {
    workspaceSettingsRepository.findByWorkspaceIds = async (workspaceIds) => {
      calls.findWorkspaceSettingsByWorkspaceIds += 1;
      const normalizedWorkspaceIds = normalizeWorkspaceIds(workspaceIds);
      if (normalizedWorkspaceIds.length < 1) {
        return [];
      }

      return limiter.run(async () => {
        await sleep(queryDelayMs);
        return normalizedWorkspaceIds
          .map((workspaceId) => workspaceSettingsById.get(workspaceId) || null)
          .filter(Boolean);
      });
    };
  }

  const service = createWorkspaceService({
    appConfig: {
      tenancyMode: "multi-workspace",
      features: {
        workspaceInvites: true,
        workspaceSwitching: true,
        workspaceCreateEnabled: true
      }
    },
    rbacManifest: {
      defaultInviteRole: "member",
      collaborationEnabled: true,
      roles: {
        owner: {
          assignable: false,
          permissions: ["*"]
        },
        member: {
          assignable: true,
          permissions: ["history.read"]
        }
      }
    },
    workspacesRepository: {
      async findBySlug() {
        return null;
      },
      async findById() {
        return null;
      },
      async findPersonalByOwnerUserId() {
        return null;
      },
      async insert() {
        throw new Error("not used");
      },
      async listByUserId(requestedUserId) {
        return Number(requestedUserId) === userId ? [...memberships] : [];
      }
    },
    workspaceMembershipsRepository: {
      async ensureOwnerMembership() {},
      async findByWorkspaceIdAndUserId() {
        return null;
      }
    },
    workspaceSettingsRepository,
    workspaceInvitesRepository: {
      async markExpiredPendingInvites() {},
      async listPendingByEmail() {
        return [];
      }
    },
    userSettingsRepository: {
      async ensureForUserId(requestedUserId) {
        return {
          avatarSize: 64,
          lastActiveWorkspaceId: Number(requestedUserId) === userId ? 1 : null
        };
      },
      async updateLastActiveWorkspaceId() {}
    },
    userAvatarService: {
      buildAvatarResponse(profile, { avatarSize }) {
        return {
          uploadedUrl: null,
          gravatarUrl: `https://www.gravatar.com/avatar/${Number(profile.id)}`,
          effectiveUrl: `https://www.gravatar.com/avatar/${Number(profile.id)}`,
          hasUploadedAvatar: false,
          size: avatarSize,
          version: null
        };
      }
    }
  });

  return {
    user,
    workspaceCount,
    service,
    calls,
    resetCalls() {
      calls.findWorkspaceSettingsByWorkspaceIds = 0;
      calls.ensureWorkspaceSettings = 0;
    }
  };
}

function computeP95Milliseconds(samplesMs) {
  if (!Array.isArray(samplesMs) || samplesMs.length < 1) {
    return 0;
  }
  const sortedSamples = [...samplesMs].sort((a, b) => a - b);
  const index = Math.min(sortedSamples.length - 1, Math.max(0, Math.ceil(sortedSamples.length * 0.95) - 1));
  return sortedSamples[index];
}

async function benchmarkBootstrap(service, user, workspaceCount, iterations) {
  const durationsMs = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const startedAt = process.hrtime.bigint();
    const payload = await service.buildBootstrapPayload({
      request: {
        headers: {
          "x-surface-id": "app"
        }
      },
      user
    });
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    durationsMs.push(durationMs);
    assert.equal(payload.workspaces.length, workspaceCount);
  }
  return durationsMs;
}

test("bootstrap workspace mapping batch-preload reduces settings query count and p95 latency", async (t) => {
  const workspaceCount = 120;
  const iterations = 24;
  const warmupIterations = 3;
  const queryDelayMs = 2;
  const queryConcurrency = 8;

  const withoutBatchFixture = createPerformanceFixture({
    workspaceCount,
    queryDelayMs,
    queryConcurrency,
    supportsBatchSettingsFetch: false
  });
  const withBatchFixture = createPerformanceFixture({
    workspaceCount,
    queryDelayMs,
    queryConcurrency,
    supportsBatchSettingsFetch: true
  });

  await benchmarkBootstrap(withoutBatchFixture.service, withoutBatchFixture.user, workspaceCount, warmupIterations);
  await benchmarkBootstrap(withBatchFixture.service, withBatchFixture.user, workspaceCount, warmupIterations);
  withoutBatchFixture.resetCalls();
  withBatchFixture.resetCalls();

  const withoutBatchSamplesMs = await benchmarkBootstrap(
    withoutBatchFixture.service,
    withoutBatchFixture.user,
    workspaceCount,
    iterations
  );
  const withBatchSamplesMs = await benchmarkBootstrap(
    withBatchFixture.service,
    withBatchFixture.user,
    workspaceCount,
    iterations
  );

  const withoutBatchP95Ms = computeP95Milliseconds(withoutBatchSamplesMs);
  const withBatchP95Ms = computeP95Milliseconds(withBatchSamplesMs);

  t.diagnostic(
    `without-batch p95=${withoutBatchP95Ms.toFixed(2)}ms ensureCalls=${withoutBatchFixture.calls.ensureWorkspaceSettings}`
  );
  t.diagnostic(
    `with-batch p95=${withBatchP95Ms.toFixed(2)}ms batchCalls=${withBatchFixture.calls.findWorkspaceSettingsByWorkspaceIds}`
  );

  assert.equal(withoutBatchFixture.calls.findWorkspaceSettingsByWorkspaceIds, 0);
  assert.equal(withoutBatchFixture.calls.ensureWorkspaceSettings, workspaceCount * iterations);

  assert.equal(withBatchFixture.calls.findWorkspaceSettingsByWorkspaceIds, iterations);
  assert.equal(withBatchFixture.calls.ensureWorkspaceSettings, 0);

  assert.equal(withBatchP95Ms < withoutBatchP95Ms, true);
  assert.equal(withBatchP95Ms <= withoutBatchP95Ms * 0.7, true);
});
