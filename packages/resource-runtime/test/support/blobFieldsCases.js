import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { createTestResourceRuntime, expectFlatQueries } from "../../src/test/index.js";

// A blob field on every database the runtime supports: writes take bytes within maxBytes, checked before any
// statement; reads answer it only when their fields name it, never as JSON, never an included table's, and never more
// than 16 MiB of it but one record's, so queryPages() shrinks its pages to fit. Each database's test file runs these
// cases on its own connection.

const WORKSPACE_A = Object.freeze({ workspace: Object.freeze({ id: "1" }) });
// expectFlatQueries() runs only against a test database, which TEST_DB_NAME names.
const TEST_ENVIRONMENT = Object.freeze({ TEST_DB_NAME: "blob_test" });
const MAX_BYTES = 4 * 1024 * 1024;

const avatarResource = defineTableResource({
  name: "avatars",
  tableName: "avatars",
  ownership: "workspace",
  lockVersionField: "lockVersion",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    albumId: { type: "id", nullable: true, belongsTo: "albums", as: "album", storage: { column: "album_id" } },
    label: { type: "string", required: true, search: true },
    image: { type: "blob", maxBytes: MAX_BYTES, nullable: true },
    lockVersion: { type: "integer", defaultTo: 0, storage: { column: "lock_version" } }
  }
});

const albumResource = defineTableResource({
  name: "albums",
  tableName: "albums",
  ownership: "workspace",
  relationships: { avatars: { type: "hasMany", target: "avatars", foreignKey: "albumId" } },
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    title: { type: "string", required: true }
  }
});

/**
 * @param {import("knex").Knex} knex
 * @param {{ afterWrite?: Function }} [hooks] The avatars' hooks.
 */
async function createAvatars(knex, hooks) {
  await knex.schema.createTable("albums", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("title").notNullable();
  });
  await knex.schema.createTable("avatars", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.integer("album_id").nullable().index();
    table.string("label").notNullable();
    // MySQL's BLOB holds 64 KiB; a column holds the field's maxBytes.
    if (knex.client.config.client === "mysql2") {
      table.specificType("image", "MEDIUMBLOB").nullable();
    } else {
      table.binary("image").nullable();
    }
    table.integer("lock_version").notNullable().defaultTo(0);
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { avatars, albums } = await runtime.own("avatars.feature", [hooks ? { resource: avatarResource, hooks } : avatarResource, albumResource]);
  const system = runtime.declareSystemScope("avatars.feature", "resize every workspace's avatars")("resize");
  return { avatars, albums, system, job: { context: system.forWorkspace("1") } };
}

async function pagesOf(pages) {
  const read = [];
  for await (const records of pages) {
    read.push(records);
  }
  return read;
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
      const page = await avatars.query({ filters: { label: "view" }, fields: ["label", "image"], page: { size: 4 } }, options);
      assert.deepEqual([...page.records[0].image], [8, 9]);
      await assert.rejects(avatars.queryAll({ fields: ["label", "image"] }, options),
        /avatars\.queryAll\(\) reads every matching row at once, so it reads no blob \(avatars\.image\): read blobs a page at a time with queryPages\(\)/u);
      await assert.rejects(avatars.query({ fields: { avatars: "label,image" }, page: { size: 10 } }, { ...options, format: "jsonapi" }),
        (error) => error.status === 400 && error.code === "JSON_API_FIELDSET_INVALID" && error.messageCode === "resource.blobFields" &&
          error.messageParams.fields === "avatars.image" && /JSON holds no binary, so their fields name no blob \(avatars\.image\)/u.test(error.message));
      await assert.rejects(avatars.get(viewed, { fields: { avatars: "image" } }, { ...options, format: "jsonapi" }), /JSON holds no binary/u);
      const locked = await avatars.withTransaction(options, async (tx) => {
        await assert.rejects(avatars.lockWhere({ label: "view" }, { ...tx, fields: ["image"] }), /avatars\.lockWhere\(\) reads every matching row at once, so it reads no blob/u);
        assert.equal(Object.hasOwn(await avatars.lock(viewed, tx), "image"), false);
        return avatars.lockMany([viewed], { ...tx, fields: ["image"] });
      });
      assert.deepEqual([...locked[0].image], [8, 9]);
    }],

    ["queryPages() reads named blobs in pages that hold at most 16 MiB of them, and every row a page without them", async (t) => {
      const knex = await connect(t, "da_bl_pages");
      const { avatars, system, job } = await createAvatars(knex);
      await avatars.createMany(Array.from({ length: 9 }, (_, index) => ({ label: `a${index}`, image: Buffer.from([index]) })), { ...job, returning: "none" });
      const sizes = async (params) => (await pagesOf(avatars.queryPages(params, job))).map((records) => records.length);
      // A 4 MiB blob: 4 rows a page.
      assert.deepEqual(await sizes({ fields: ["label", "image"] }), [4, 4, 1]);
      assert.deepEqual(await sizes({ fields: ["label"] }), [9]);
      const last = [];
      for await (const records of avatars.queryPages({ filters: { label: "a8" }, fields: ["image"] }, job)) {
        last.push(...records.map(({ image }) => [...image]));
      }
      assert.deepEqual(last, [[8]]);

      // Each later page's own statement is allowed, as a many-row write's later chunks are, so the paged read is flat.
      let workspace = 1;
      const seed = async (size) => {
        workspace += 1;
        const options = { context: system.forWorkspace(String(workspace)), returning: "none" };
        await avatars.createMany(Array.from({ length: size }, (_, index) => ({ label: `w${index}`, image: Buffer.from([index]) })), options);
        return String(workspace);
      };
      const run = async (seeded) => (await pagesOf(avatars.queryPages({ fields: ["image"] }, { context: system.forWorkspace(seeded) }))).flat().length;
      assert.deepEqual(await expectFlatQueries({ knex, environment: TEST_ENVIRONMENT, sizes: [5, 20], seed, run }),
        [{ size: 5, count: 2, chunkStatements: 1 }, { size: 20, count: 5, chunkStatements: 4 }]);
    }],

    ["a write whose blob is wrong sends no statement, not a lock or a BEGIN, whatever the patch's conditions or the table's hooks", async (t) => {
      const knex = await connect(t, "da_bl_first");
      const written = [];
      const { avatars } = await createAvatars(knex, { afterWrite: ({ operation }) => { written.push(operation); } });
      const options = { context: WORKSPACE_A };
      const { id, lockVersion } = await avatars.create({ label: "framed", image: Buffer.from([1]) }, options);
      const oversize = Buffer.alloc(MAX_BYTES + 1);
      const writes = [
        () => avatars.patch(id, { image: oversize }, { ...options, lockVersion }),
        () => avatars.patch(id, { image: oversize }, { ...options, onlyIf: { label: "framed" } }),
        () => avatars.patch(id, { image: oversize }, options),
        () => avatars.create({ label: "big", image: oversize }, options),
        () => avatars.createMany([{ label: "big", image: oversize }], options),
        () => avatars.patchMany([{ id, image: oversize }], options),
        () => avatars.patchWhere({ id: [id] }, { image: oversize }, options),
        () => avatars.findOrCreate({ id: "999", label: "big", image: oversize }, options),
        () => avatars.lockOrCreate({ id: "999", label: "big", image: oversize }, options, () => null)
      ];
      for (const write of writes) {
        const refused = await countQueries(knex, () => assert.rejects(write(), validation("max_bytes")));
        assert.equal(refused.count, 0);
      }
      assert.deepEqual(written, ["create"]);
    }],

    ["a read holds at most 16 MiB of blobs, or one record's, and no included table's: a query page, a lockMany() list, an include and a join source", async (t) => {
      const knex = await connect(t, "da_bl_bound");
      const { avatars, albums, job } = await createAvatars(knex);
      const options = { context: WORKSPACE_A };
      const ids = await avatars.createMany(Array.from({ length: 5 }, (_, index) => ({ label: `b${index}`, image: Buffer.from([index]) })), { ...options, returning: "ids" });
      const albumId = await albums.create({ title: "Faces" }, { ...options, returning: "id" });

      // A 4 MiB blob: 4 records hold 16 MiB.
      assert.equal((await avatars.query({ fields: ["image"], page: { size: 4 } }, options)).records.length, 4);
      const page = await countQueries(knex, () => assert.rejects(avatars.query({ fields: ["image"], page: { size: 5 } }, options),
        /avatars\.query\(\) reads up to 5 records, and 4 of them already hold 16 MiB of avatars\.image: read at most 4 at a time/u));
      assert.equal(page.count, 0);
      await avatars.withTransaction(options, async (tx) => {
        await assert.rejects(avatars.lockMany(ids, { ...tx, fields: ["image"] }), /avatars\.lockMany\(\) reads up to 5 records/u);
        assert.equal((await avatars.lockMany(ids.slice(0, 4), { ...tx, fields: ["image"] })).length, 4);
      });

      // An include holds any number of records, so no read names an included table's blob.
      const faces = { include: ["avatars"], fields: { albums: "title", avatars: "label,image" } };
      const included = /albums\.(get|query|queryPages|queryAll)\(\) fields name avatars\.image, a blob of an included table/u;
      const reads = [
        () => albums.get(albumId, faces, options),
        () => albums.query({ ...faces, page: { size: 10 } }, options),
        () => albums.queryAll(faces, options),
        () => pagesOf(albums.queryPages(faces, job))
      ];
      for (const read of reads) {
        const refused = await countQueries(knex, () => assert.rejects(read(), included));
        assert.equal(refused.count, 0);
      }

      // A join source carries no blob, so a report's select of every column reads none.
      const source = await avatars.joinSource({ alias: "a" }, options);
      const [row] = await source.query.select("a.*").orderBy("a.id").limit(1);
      assert.equal(Object.hasOwn(row, "image"), false);
      assert.equal(row.label, "b0");
      assert.throws(() => source.column("image"), /avatars\.joinSource\(\) carries no blob, so it has no column for "image"/u);
    }]
  ];
}

export { blobFieldsCases };
