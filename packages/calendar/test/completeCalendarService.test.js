import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/completeCalendar/completeCalendarService.js";

function createRepositoryStub() {
  return {
    async listWeek() {
      return [
        {
          id: 1,
          contactId: 7,
          title: "Intro",
          notes: "",
          startsAt: "2026-03-11T01:00:00.000Z",
          endsAt: "2026-03-11T01:30:00.000Z",
          status: "scheduled",
          createdAt: "2026-03-11T00:00:00.000Z",
          updatedAt: "2026-03-11T00:00:00.000Z"
        }
      ];
    },
    async findById() {
      return {
        id: 1,
        contactId: 7,
        title: "Intro",
        notes: "",
        startsAt: "2026-03-11T01:00:00.000Z",
        endsAt: "2026-03-11T01:30:00.000Z",
        status: "scheduled",
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z"
      };
    },
    async create(payload) {
      return {
        id: 1,
        ...payload,
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z"
      };
    },
    async updateById(eventId, payload) {
      return {
        id: eventId,
        contactId: payload.contactId || 7,
        title: payload.title || "Intro",
        notes: payload.notes || "",
        startsAt: payload.startsAt || "2026-03-11T01:00:00.000Z",
        endsAt: payload.endsAt || "2026-03-11T01:30:00.000Z",
        status: payload.status || "scheduled",
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z"
      };
    },
    async deleteById(eventId) {
      return {
        id: eventId,
        deleted: true
      };
    },
    async findVisibleContactById(contactId) {
      if (Number(contactId) !== 7) {
        return null;
      }

      return {
        id: 7,
        name: "Ada",
        surname: "Lovelace"
      };
    },
    async findVisibleContactsByIds(ids) {
      return ids.includes(7)
        ? [
            {
              id: 7,
              name: "Ada",
              surname: "Lovelace"
            }
          ]
        : [];
    }
  };
}

test("completeCalendarService returns week list with contact summaries", async () => {
  const service = createService({
    completeCalendarRepository: createRepositoryStub()
  });

  const result = await service.listWeek({ weekStart: "2026-03-11" });

  assert.equal(Array.isArray(result.items), true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].contact.name, "Ada");
});

test("completeCalendarService validates event range", async () => {
  const service = createService({
    completeCalendarRepository: createRepositoryStub()
  });

  await assert.rejects(
    () =>
      service.createEvent({
        contactId: 7,
        title: "Invalid",
        startsAt: "2026-03-11T01:30:00.000Z",
        endsAt: "2026-03-11T01:00:00.000Z"
      }),
    (error) => error?.status === 400 && error?.message === "Event end must be after event start."
  );
});
