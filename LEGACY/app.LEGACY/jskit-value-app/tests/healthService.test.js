import assert from "node:assert/strict";
import test from "node:test";

import { createService } from "../server/modules/health/service.js";

const FIXED_NOW = new Date("2026-02-19T00:00:00.000Z");

test("health service validates required repository dependency", () => {
  assert.throws(() => createService({}), /healthRepository\.checkDatabase is required/);
});

test("health service returns liveness payload", async () => {
  const service = createService({
    healthRepository: {
      async checkDatabase() {
        return true;
      }
    },
    now: () => FIXED_NOW,
    uptimeSeconds: () => 12.345
  });

  const payload = await service.health();
  assert.deepEqual(payload, {
    ok: true,
    status: "ok",
    timestamp: FIXED_NOW.toISOString(),
    uptimeSeconds: 12.345
  });
});

test("health service reports readiness healthy when database probe succeeds", async () => {
  let dbProbeCalls = 0;
  const service = createService({
    healthRepository: {
      async checkDatabase() {
        dbProbeCalls += 1;
      }
    },
    now: () => FIXED_NOW,
    uptimeSeconds: () => 8
  });

  const payload = await service.readiness();
  assert.equal(dbProbeCalls, 1);
  assert.deepEqual(payload, {
    ok: true,
    status: "ok",
    timestamp: FIXED_NOW.toISOString(),
    uptimeSeconds: 8,
    dependencies: {
      database: "up"
    }
  });
});

test("health service reports readiness degraded when database probe fails", async () => {
  const service = createService({
    healthRepository: {
      async checkDatabase() {
        throw new Error("db down");
      }
    },
    now: () => FIXED_NOW,
    uptimeSeconds: () => 4
  });

  const payload = await service.readiness();
  assert.deepEqual(payload, {
    ok: false,
    status: "degraded",
    timestamp: FIXED_NOW.toISOString(),
    uptimeSeconds: 4,
    dependencies: {
      database: "down"
    }
  });
});
