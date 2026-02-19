import assert from "node:assert/strict";
import test from "node:test";

import { createService as createAuditService, __testables } from "../server/domain/security/services/audit.service.js";

test("security audit service normalizes events and redacts sensitive metadata", async () => {
  let insertedEvent = null;
  const service = createAuditService({
    auditEventsRepository: {
      async insert(event) {
        insertedEvent = event;
        return {
          id: 1,
          ...event
        };
      }
    }
  });

  const result = await service.record({
    action: "workspace.invite.created",
    outcome: "failure",
    actorUserId: "42",
    actorEmail: "Owner@Example.com ",
    workspaceId: "7",
    requestId: "req-1",
    method: "post",
    path: "/api/workspace/acme/invites",
    ipAddress: "203.0.113.10",
    userAgent: "Jest Agent",
    metadata: {
      email: "invitee@example.com",
      password: "super-secret",
      nested: {
        refreshToken: "abc123",
        keep: true
      }
    }
  });

  assert.equal(result.id, 1);
  assert.equal(insertedEvent.action, "workspace.invite.created");
  assert.equal(insertedEvent.outcome, "failure");
  assert.equal(insertedEvent.actorUserId, 42);
  assert.equal(insertedEvent.actorEmail, "owner@example.com");
  assert.equal(insertedEvent.workspaceId, 7);
  assert.equal(insertedEvent.method, "POST");
  assert.equal(insertedEvent.metadata.email, "invitee@example.com");
  assert.equal(insertedEvent.metadata.password, "[REDACTED]");
  assert.equal(insertedEvent.metadata.nested.refreshToken, "[REDACTED]");
  assert.equal(insertedEvent.metadata.nested.keep, true);
});

test("security audit service recordSafe is best effort and logs failures", async () => {
  const service = createAuditService({
    auditEventsRepository: {
      async insert() {
        throw Object.assign(new Error("db unavailable"), {
          status: 503,
          code: "DB_DOWN"
        });
      }
    }
  });

  const warnings = [];
  const logger = {
    warn(payload, message) {
      warnings.push({ payload, message });
    }
  };

  const result = await service.recordSafe(
    {
      action: "console.invite.created",
      requestId: "req-failed"
    },
    logger
  );

  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].message, "security.audit.record_failed");
  assert.equal(warnings[0].payload.action, "console.invite.created");
  assert.equal(warnings[0].payload.auditError.code, "DB_DOWN");
});

test("security audit service requires action", async () => {
  const service = createAuditService({
    auditEventsRepository: {
      async insert(event) {
        return event;
      }
    }
  });

  await assert.rejects(() => service.record({ outcome: "success" }), /action is required/i);
});

test("security audit metadata helper redacts token-like keys deeply", () => {
  const sanitized = __testables.sanitizeMetadata({
    token: "t1",
    level1: {
      apiKey: "k1",
      level2: {
        secret: "s1",
        allowed: "ok"
      }
    }
  });

  assert.equal(sanitized.token, "[REDACTED]");
  assert.equal(sanitized.level1.apiKey, "[REDACTED]");
  assert.equal(sanitized.level1.level2.secret, "[REDACTED]");
  assert.equal(sanitized.level1.level2.allowed, "ok");
});
