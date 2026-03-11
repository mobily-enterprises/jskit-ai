import test from "node:test";
import assert from "node:assert/strict";
import { completeCalendarResource } from "../src/shared/completeCalendar/completeCalendarResource.js";

test("completeCalendarResource normalizes create payload", () => {
  const normalized = completeCalendarResource.operations.create.body.normalize({
    contactId: "5",
    title: "  Intro call  ",
    notes: "  Bring contract draft  ",
    startsAt: "2026-03-11T01:00:00.000Z",
    endsAt: "2026-03-11T01:30:00.000Z",
    status: "SCHEDULED"
  });

  assert.deepEqual(normalized, {
    contactId: 5,
    title: "Intro call",
    notes: "Bring contract draft",
    startsAt: "2026-03-11T01:00:00.000Z",
    endsAt: "2026-03-11T01:30:00.000Z",
    status: "scheduled"
  });
});

test("completeCalendarResource normalizes list output", () => {
  const normalized = completeCalendarResource.operations.list.output.normalize({
    weekStart: " 2026-03-09T00:00:00.000Z ",
    weekEnd: " 2026-03-16T00:00:00.000Z ",
    items: [
      {
        id: "4",
        contactId: "7",
        title: " Intro call ",
        notes: " Notes ",
        startsAt: "2026-03-11T01:00:00.000Z",
        endsAt: "2026-03-11T01:30:00.000Z",
        status: "COMPLETED",
        contact: {
          id: "7",
          name: " Ada ",
          surname: " Lovelace "
        },
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z"
      }
    ]
  });

  assert.equal(normalized.weekStart, "2026-03-09T00:00:00.000Z");
  assert.equal(normalized.weekEnd, "2026-03-16T00:00:00.000Z");
  assert.equal(normalized.items[0].id, 4);
  assert.equal(normalized.items[0].contactId, 7);
  assert.equal(normalized.items[0].contact.name, "Ada");
  assert.equal(normalized.items[0].status, "completed");
});
