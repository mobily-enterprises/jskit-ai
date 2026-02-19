import assert from "node:assert/strict";
import test from "node:test";

import { withAuditEvent } from "../server/lib/securityAudit.js";

test("withAuditEvent applies shared fields and shared metadata across success/failure", async () => {
  const events = [];
  const auditService = {
    async recordSafe(event) {
      events.push(event);
    }
  };

  const request = {
    id: "req-1",
    method: "POST",
    url: "/api/console/invites/1",
    headers: {
      "x-forwarded-for": "198.51.100.10, 203.0.113.7",
      "user-agent": "audit-lib-test"
    },
    user: {
      id: 11,
      email: "User@Example.com"
    }
  };

  const successResult = await withAuditEvent({
    auditService,
    request,
    action: "console.invite.revoked",
    execute: async () => ({ inviteId: 99 }),
    shared: () => ({
      targetUserId: 11
    }),
    metadata: () => ({
      resource: "invite"
    }),
    onSuccess: (context) => ({
      metadata: {
        inviteId: context?.result?.inviteId
      }
    })
  });

  assert.equal(successResult.inviteId, 99);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "success");
  assert.equal(events[0].surface, "console");
  assert.equal(events[0].targetUserId, 11);
  assert.equal(events[0].metadata.resource, "invite");
  assert.equal(events[0].metadata.inviteId, 99);

  await assert.rejects(
    () =>
      withAuditEvent({
        auditService,
        request,
        action: "console.invite.revoked",
        execute: async () => {
          throw Object.assign(new Error("conflict"), {
            status: 409,
            code: "INVITE_CONFLICT"
          });
        },
        shared: () => ({
          targetUserId: 11
        }),
        metadata: () => ({
          resource: "invite"
        })
      }),
    /conflict/
  );

  assert.equal(events.length, 2);
  assert.equal(events[1].outcome, "failure");
  assert.equal(events[1].targetUserId, 11);
  assert.equal(events[1].metadata.resource, "invite");
  assert.equal(events[1].metadata.error.status, 409);
  assert.equal(events[1].metadata.error.code, "INVITE_CONFLICT");
});

test("withAuditEvent does not break business flow when audit callbacks throw", async () => {
  const events = [];
  const warnings = [];
  const auditService = {
    async recordSafe(event) {
      events.push(event);
    }
  };
  const request = {
    id: "req-2",
    method: "POST",
    url: "/api/admin/users/1",
    headers: {
      "user-agent": "audit-lib-test-2"
    },
    user: {
      id: 7,
      email: "ops@example.com"
    },
    log: {
      warn(payload, message) {
        warnings.push({ payload, message });
      }
    }
  };

  const successResult = await withAuditEvent({
    auditService,
    request,
    action: "admin.user.updated",
    execute: async () => ({ ok: true }),
    metadata: () => {
      throw new Error("metadata callback failed");
    }
  });
  assert.equal(successResult.ok, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "success");
  assert.equal(events[0].surface, "admin");
  assert.equal(events[0].metadata, undefined);

  await assert.rejects(
    () =>
      withAuditEvent({
        auditService,
        request,
        action: "admin.user.updated",
        execute: async () => {
          throw Object.assign(new Error("domain failure"), {
            status: 409,
            code: "CONFLICT"
          });
        },
        metadata: () => {
          throw new Error("failure metadata callback failed");
        }
      }),
    /domain failure/
  );

  assert.equal(events.length, 2);
  assert.equal(events[1].outcome, "failure");
  assert.equal(events[1].metadata.error.status, 409);
  assert.equal(events[1].metadata.error.code, "CONFLICT");
  assert.equal(
    warnings.some((entry) => entry.message === "security.audit.callback_failed"),
    true
  );
});

test("withAuditEvent requires auditService.recordSafe", async () => {
  await assert.rejects(
    () =>
      withAuditEvent({
        auditService: {},
        request: {},
        action: "console.invite.created",
        execute: async () => ({ ok: true })
      }),
    /auditService\.recordSafe is required/
  );
});
