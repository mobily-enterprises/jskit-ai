import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { createTestResourceRuntime } from "../../src/test/index.js";

// A blob field on every database the runtime supports: writes take bytes within maxBytes, checked before any
// statement; reads answer it only when their fields name it, never as JSON, never in a read of every row at once, and
// queryPages() shrinks its pages to hold at most 16 MiB of it. Each database's test file runs these cases on its own
// connection.

const WORKSPACE_A = Object.freeze({ workspace: Object.freeze({ id: "1" }) });
const MAX_BYTES = 4 * 1024 * 1024;

const avatarResource = defineTableResource({
  name: "avatars",
  tableName: "avatars",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    label: { type: "string", required: true, search: true },
    image: { type: "blob", maxBytes: MAX_BYTES, nullable: true }
  }
});

async function createAvatars(knex) {
  await knex.schema.createTable("avatars", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("label").notNullable();
    // MySQL's BLOB holds 64 KiB; a column holds the field's maxBytes.
    if (knex.client.config.client === "mysql2") {
      table.specificType("image", "MEDIUMBLOB").nullable();
    } else {
      table.binary("image").nullable();
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { avatars } = await runtime.own("avatars.feature", [avatarResource]);
  const job = runtime.declareSystemScope("avatars.feature", "resize every workspace's avatars")("resize").forWorkspace("1");
  return { avatars, job: { context: job } };
}

const validation = (rule) => (error) => error.code === "REST_API_VALIDATION" && error.details.violations[0].field === "image" &&
  error.details.violations[0].rule === rule;

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function blobFieldsCases(connect) {
  return [
    ["a blob field takes bytes within maxBytes, refusing anything else before any statement, and a read answers it only when its fields name it", async (t) => {
      const knex = await connect(t, "da_bl_values");
      const { avatars } = await createAvatars(knex);
      const options = { context: WORKSPACE_A };
      const bytes = Buffer.from([0, 1, 2, 255]);

      const created = await avatars.create({ label: "plain", image: bytes }, options);
      assert.equal(Object.hasOwn(created, "image"), false);
      const read = await avatars.get(created.id, { fields: ["label", "image"] }, options);
      assert.equal(Buffer.isBuffer(read.image), true);
      assert.deepEqual([...read.image], [0, 1, 2, 255]);
      assert.equal(Object.hasOwn(await avatars.get(created.id, {}, options), "image"), false);

      const viewed = await avatars.create({ label: "view", image: new Uint8Array([7, 8, 9]).subarray(1) }, { ...options, returning: "id" });
      assert.deepEqual([...(await avatars.get(viewed, { fields: ["image"] }, options)).image], [8, 9]);

      for (const [value, rule] of [["text", "blob"], [[1, 2], "blob"], [{ data: [1] }, "blob"], [Buffer.alloc(MAX_BYTES + 1), "max_bytes"]]) {
        const refused = await countQueries(knex, () => assert.rejects(avatars.create({ label: "bad", image: value }, options), validation(rule)));
        assert.equal(refused.count, 0);
      }
      await assert.rejects(avatars.createMany([{ label: "ok", image: bytes }, { label: "bad", image: "text" }], options), validation("blob"));
      await assert.rejects(avatars.patchMany([{ id: created.id, image: Buffer.alloc(MAX_BYTES + 1) }], options), validation("max_bytes"));
      await assert.rejects(avatars.patchWhere({ id: [created.id] }, { image: 5 }, options), validation("blob"));
      await avatars.patch(created.id, { image: Buffer.alloc(MAX_BYTES) }, { ...options, returning: "none" });
      assert.equal((await avatars.get(created.id, { fields: ["image"] }, options)).image.byteLength, MAX_BYTES);
      await avatars.patch(created.id, { image: null }, { ...options, returning: "none" });
      assert.equal((await avatars.get(created.id, { fields: ["image"] }, options)).image, null);

      // One page names it; a read of every row at once, a JSON:API read and a filter lock do not.
      const page = await avatars.query({ filters: { label: "view" }, fields: ["label", "image"], page: { size: 10 } }, options);
      assert.deepEqual([...page.records[0].image], [8, 9]);
      await assert.rejects(avatars.queryAll({ fields: ["label", "image"] }, options),
        /avatars\.queryAll\(\) reads every matching row at once, so it reads no blob \(avatars\.image\): read blobs a page at a time with queryPages\(\)/u);
      await assert.rejects(avatars.query({ fields: { avatars: "label,image" }, page: { size: 10 } }, { ...options, format: "jsonapi" }),
        (error) => error.status === 400 && error.code === "JSON_API_FIELDSET_INVALID" && error.messageCode === "resource.blobFields" &&
          error.messageParams.fields === "avatars.image" && /JSON holds no binary, so their fields name no blob \(avatars\.image\)/u.test(error.message));
      await assert.rejects(avatars.get(viewed, { fields: { avatars: "image" } }, { ...options, format: "jsonapi" }), /JSON holds no binary/u);
      const locked = await avatars.withTransaction(options, async (tx) => {
        await assert.rejects(avatars.lockWhere({ label: "view" }, { ...tx, fields: ["image"] }), /avatars\.lockWhere\(\) reads every matching row at once, so it reads no blob/u);
        return avatars.lockMany([viewed], { ...tx, fields: ["image"] });
      });
      assert.deepEqual([...locked[0].image], [8, 9]);
    }],

    ["queryPages() reads named blobs in pages that hold at most 16 MiB of them, and every row a page without them", async (t) => {
      const knex = await connect(t, "da_bl_pages");
      const { avatars, job } = await createAvatars(knex);
      await avatars.createMany(Array.from({ length: 9 }, (_, index) => ({ label: `a${index}`, image: Buffer.from([index]) })), { ...job, returning: "none" });
      const sizes = async (params) => {
        const read = [];
        for await (const records of avatars.queryPages(params, job)) {
          read.push(records.length);
        }
        return read;
      };
      // A 4 MiB blob: 4 rows a page.
      assert.deepEqual(await sizes({ fields: ["label", "image"] }), [4, 4, 1]);
      assert.deepEqual(await sizes({ fields: ["label"] }), [9]);
      const last = [];
      for await (const records of avatars.queryPages({ filters: { label: "a8" }, fields: ["image"] }, job)) {
        last.push(...records.map(({ image }) => [...image]));
      }
      assert.deepEqual(last, [[8]]);
    }]
  ];
}

export { blobFieldsCases };
