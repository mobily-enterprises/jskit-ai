# Realtime Envelope Contracts

Last updated: 2026-02-25 (UTC)

This document defines required realtime envelope fields by delivery scope.

## 1) Workspace broadcast events

Used for workspace topic room fanout (`w:<workspaceId>:t:<topic>`).

Required fields:
- `eventId`
- `eventType`
- `topic`
- `workspaceId` (positive integer)
- `workspaceSlug` (non-empty string)

Recommended fields:
- `entityType`, `entityId`
- `commandId`, `sourceClientId`, `actorUserId`
- `payload`

## 2) Workspace-targeted events

Used for user-room fanout with workspace re-authorization.

Required fields:
- `eventId`
- `eventType`
- `topic`
- `scopeKind: "workspace"`
- `workspaceId` (positive integer)
- `workspaceSlug` (non-empty string)
- `targetUserIds` (non-empty array)

Delivery requirements:
- Socket must be subscribed to matching workspace topic.
- Runtime runs `canSocketReceiveEvent` before emit.
- On deny with eviction, workspace topic subscription is removed.

## 3) Global-targeted events

Used for user-room fanout without workspace context (for example, global DM signals).

Required fields:
- `eventId`
- `eventType`
- `targetUserIds` (non-empty array)
- `scopeKind: "global"`

Optional fields:
- `topic` (if present, surface allow-list checks still apply)
- `payload`, `commandId`, `sourceClientId`, `actorUserId`

## 4) User-scoped topic events

Used for user-topic room fanout (`u:<userId>:t:<topic>`).

Required fields:
- `eventId`
- `eventType`
- `topic` (topic scope must be `user`)
- `targetUserIds` (non-empty array)

Delivery requirements:
- Socket must subscribe to user-topic room.
- Surface must be allowed for the topic.
