import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { createService } from "../server/modules/alerts/service.js";
import { REALTIME_EVENT_TYPES, REALTIME_TOPICS } from "../shared/eventTypes.js";

function createAlertsRepositoryFixture({
  alerts = [],
  readState = null
} = {}) {
  const state = {
    alerts: alerts.map((entry) => ({ ...entry })),
    readState: readState ? { ...readState } : null,
    transactionCalls: 0
  };

  const repository = {
    async insertAlert(alertInput) {
      const nextId = state.alerts.length > 0 ? Math.max(...state.alerts.map((entry) => Number(entry.id))) + 1 : 1;
      const entry = {
        id: nextId,
        userId: Number(alertInput.userId),
        type: String(alertInput.type || ""),
        title: String(alertInput.title || ""),
        message: alertInput.message == null ? null : String(alertInput.message || ""),
        targetUrl: String(alertInput.targetUrl || ""),
        payloadJson: alertInput.payloadJson && typeof alertInput.payloadJson === "object" ? { ...alertInput.payloadJson } : null,
        actorUserId: alertInput.actorUserId == null ? null : Number(alertInput.actorUserId),
        workspaceId: alertInput.workspaceId == null ? null : Number(alertInput.workspaceId),
        createdAt: new Date().toISOString()
      };
      state.alerts.push(entry);
      return { ...entry };
    },
    async listAlertsForUser(userId, page, pageSize) {
      const normalizedUserId = Number(userId);
      const offset = (Math.max(1, Number(page) || 1) - 1) * Math.max(1, Number(pageSize) || 20);
      return state.alerts
        .filter((entry) => Number(entry.userId) === normalizedUserId)
        .sort((left, right) => Number(right.id) - Number(left.id))
        .slice(offset, offset + Math.max(1, Number(pageSize) || 20))
        .map((entry) => ({ ...entry }));
    },
    async countAlertsForUser(userId) {
      const normalizedUserId = Number(userId);
      return state.alerts.filter((entry) => Number(entry.userId) === normalizedUserId).length;
    },
    async countUnreadAlertsForUser(userId, readThroughAlertId) {
      const normalizedUserId = Number(userId);
      const threshold = Number(readThroughAlertId || 0);
      return state.alerts.filter((entry) => Number(entry.userId) === normalizedUserId && Number(entry.id) > threshold).length;
    },
    async getLatestAlertIdForUser(userId) {
      const normalizedUserId = Number(userId);
      const ids = state.alerts
        .filter((entry) => Number(entry.userId) === normalizedUserId)
        .map((entry) => Number(entry.id))
        .filter((id) => Number.isInteger(id) && id > 0);
      return ids.length > 0 ? Math.max(...ids) : null;
    },
    async getReadStateForUser(userId) {
      if (!state.readState || Number(state.readState.userId) !== Number(userId)) {
        return null;
      }

      return {
        ...state.readState
      };
    },
    async upsertReadStateForUser(userId, readThroughAlertId) {
      state.readState = {
        userId: Number(userId),
        readThroughAlertId: readThroughAlertId == null ? null : Number(readThroughAlertId),
        updatedAt: new Date().toISOString()
      };
      return {
        ...state.readState
      };
    },
    async transaction(work) {
      state.transactionCalls += 1;
      return work(null);
    }
  };

  return {
    state,
    repository
  };
}

function createRealtimeEventsServiceFixture({ throwOnPublish = false } = {}) {
  const state = {
    createEventEnvelopeCalls: 0,
    published: []
  };

  const service = {
    createEventEnvelope(eventInput = {}) {
      state.createEventEnvelopeCalls += 1;
      return {
        eventId: `evt_${state.createEventEnvelopeCalls}`,
        occurredAt: "2026-02-25T00:00:00.000Z",
        ...eventInput
      };
    },
    publish(eventEnvelope) {
      if (throwOnPublish) {
        throw new Error("publish failed");
      }

      state.published.push({
        ...eventEnvelope
      });
    }
  };

  return {
    state,
    service
  };
}

test("alerts service validates required dependencies", () => {
  assert.throws(() => createService({}), /alertsRepository is required/);
});

test("alerts service lists user alerts with unread status and pagination metadata", async () => {
  const fixture = createAlertsRepositoryFixture({
    alerts: [
      {
        id: 1,
        userId: 7,
        type: "workspace.invite.received",
        title: "Workspace invite",
        message: "Invite 1",
        targetUrl: "/workspaces",
        payloadJson: null,
        actorUserId: null,
        workspaceId: 11,
        createdAt: "2026-02-25T00:00:00.000Z"
      },
      {
        id: 2,
        userId: 7,
        type: "console.invite.received",
        title: "Console invite",
        message: "Invite 2",
        targetUrl: "/console/invitations",
        payloadJson: null,
        actorUserId: null,
        workspaceId: null,
        createdAt: "2026-02-25T00:01:00.000Z"
      }
    ],
    readState: {
      userId: 7,
      readThroughAlertId: 1
    }
  });

  const service = createService({
    alertsRepository: fixture.repository
  });

  const response = await service.listForUser(
    {
      id: 7
    },
    {
      page: 1,
      pageSize: 20
    }
  );

  assert.equal(response.page, 1);
  assert.equal(response.pageSize, 20);
  assert.equal(response.total, 2);
  assert.equal(response.totalPages, 1);
  assert.equal(response.unreadCount, 1);
  assert.equal(response.readThroughAlertId, 1);
  assert.equal(response.entries.length, 2);
  assert.equal(response.entries[0].id, 2);
  assert.equal(response.entries[0].isUnread, true);
  assert.equal(response.entries[1].id, 1);
  assert.equal(response.entries[1].isUnread, false);
});

test("alerts service rejects unauthenticated list requests", async () => {
  const fixture = createAlertsRepositoryFixture();
  const service = createService({
    alertsRepository: fixture.repository
  });

  await assert.rejects(
    () => service.listForUser({ id: 0 }, { page: 1, pageSize: 20 }),
    (error) => error instanceof AppError && error.statusCode === 401
  );
});

test("alerts service markAllRead moves read cursor to latest alert id", async () => {
  const fixture = createAlertsRepositoryFixture({
    alerts: [
      {
        id: 5,
        userId: 7,
        type: "workspace.invite.received",
        title: "Workspace invite",
        message: null,
        targetUrl: "/workspaces",
        payloadJson: null,
        actorUserId: null,
        workspaceId: null,
        createdAt: "2026-02-25T00:00:00.000Z"
      }
    ]
  });
  const service = createService({
    alertsRepository: fixture.repository
  });

  const response = await service.markAllReadForUser({
    id: 7
  });

  assert.equal(response.unreadCount, 0);
  assert.equal(response.readThroughAlertId, 5);
  assert.equal(fixture.state.transactionCalls, 1);
});

test("alerts service createAlert validates payload and targetUrl rules", async () => {
  const fixture = createAlertsRepositoryFixture();
  const realtimeFixture = createRealtimeEventsServiceFixture();
  const service = createService({
    alertsRepository: fixture.repository,
    realtimeEventsService: realtimeFixture.service
  });

  await assert.rejects(
    () =>
      service.createAlert({
        userId: 7,
        type: "workspace.invite.received",
        title: "Invite",
        targetUrl: "https://example.com"
      }),
    (error) =>
      error instanceof AppError &&
      error.statusCode === 400 &&
      error.details?.fieldErrors?.targetUrl === "targetUrl must start with /."
  );

  const created = await service.createAlert({
    userId: 7,
    type: "workspace.invite.received",
    title: "Invite",
    message: "  You have an invite. ",
    targetUrl: "/workspaces",
    payloadJson: { roleId: "member" },
    actorUserId: 9,
    workspaceId: 11
  });

  assert.equal(created.userId, 7);
  assert.equal(created.type, "workspace.invite.received");
  assert.equal(created.title, "Invite");
  assert.equal(created.message, "You have an invite.");
  assert.equal(created.targetUrl, "/workspaces");
  assert.deepEqual(created.payloadJson, { roleId: "member" });
  assert.equal(realtimeFixture.state.createEventEnvelopeCalls, 1);
  assert.equal(realtimeFixture.state.published.length, 1);
  assert.equal(realtimeFixture.state.published[0].eventType, REALTIME_EVENT_TYPES.USER_ALERT_CREATED);
  assert.equal(realtimeFixture.state.published[0].topic, REALTIME_TOPICS.ALERTS);
  assert.deepEqual(realtimeFixture.state.published[0].targetUserIds, [7]);
});

test("alerts service createAlert keeps write successful when realtime publish fails", async () => {
  const fixture = createAlertsRepositoryFixture();
  const realtimeFixture = createRealtimeEventsServiceFixture({
    throwOnPublish: true
  });
  const service = createService({
    alertsRepository: fixture.repository,
    realtimeEventsService: realtimeFixture.service
  });

  const created = await service.createAlert({
    userId: 15,
    type: "workspace.invite.received",
    title: "Invite",
    targetUrl: "/workspaces"
  });

  assert.equal(created.userId, 15);
  assert.equal(fixture.state.alerts.length, 1);
});

test("alerts service invite helper methods create typed invite alerts", async () => {
  const fixture = createAlertsRepositoryFixture();
  const service = createService({
    alertsRepository: fixture.repository
  });

  const workspaceAlert = await service.createWorkspaceInviteAlert({
    userId: 9,
    workspaceId: 11,
    workspaceName: "Acme",
    roleId: "admin",
    actorUserId: 7
  });
  assert.equal(workspaceAlert.type, "workspace.invite.received");
  assert.equal(workspaceAlert.targetUrl, "/workspaces");
  assert.equal(workspaceAlert.workspaceId, 11);

  const consoleAlert = await service.createConsoleInviteAlert({
    userId: 9,
    roleId: "member",
    actorUserId: 7
  });
  assert.equal(consoleAlert.type, "console.invite.received");
  assert.equal(consoleAlert.targetUrl, "/console/invitations");
});
