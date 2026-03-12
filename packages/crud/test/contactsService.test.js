import test from "node:test";
import assert from "node:assert/strict";
import { createService } from "../src/server/contacts/contactsService.js";

test("contactsService delegates CRUD operations to the repository", async () => {
  const calls = [];
  const contactsRepository = {
    async list(query) {
      calls.push(["list", query]);
      return { items: [], nextCursor: null };
    },
    async findById(contactId) {
      calls.push(["findById", contactId]);
      return { id: contactId, name: "Ada", surname: "Lovelace" };
    },
    async create(payload) {
      calls.push(["create", payload]);
      return { id: 1, ...payload };
    },
    async updateById(contactId, payload) {
      calls.push(["updateById", contactId, payload]);
      return { id: contactId, ...payload };
    },
    async deleteById(contactId) {
      calls.push(["deleteById", contactId]);
      return { id: contactId, deleted: true };
    }
  };

  const service = createService({ contactsRepository });

  await service.listContacts({ limit: 10 });
  await service.getContact(3);
  await service.createContact({ name: "Ada", surname: "Lovelace" });
  await service.updateContact(4, { surname: "Byron" });
  await service.deleteContact(5);

  assert.deepEqual(calls, [
    ["list", { limit: 10 }],
    ["findById", 3],
    ["create", { name: "Ada", surname: "Lovelace" }],
    ["updateById", 4, { surname: "Byron" }],
    ["deleteById", 5]
  ]);
});

test("contactsService throws 404 when a contact is missing", async () => {
  const service = createService({
    contactsRepository: {
      async list() {
        return { items: [], nextCursor: null };
      },
      async findById() {
        return null;
      },
      async create(payload) {
        return { id: 1, ...payload };
      },
      async updateById() {
        return null;
      },
      async deleteById() {
        return null;
      }
    }
  });

  await assert.rejects(
    () => service.getContact(9),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );

  await assert.rejects(
    () => service.updateContact(9, { name: "Ada" }),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );

  await assert.rejects(
    () => service.deleteContact(9),
    (error) => error?.status === 404 && error?.message === "Record not found."
  );
});
