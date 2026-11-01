import assert from "node:assert/strict";
import test from "node:test";
import knex from "knex";
import { verifyConversationStorageContract } from "@jskit-ai/assistant-core/testing/conversation-storage";
import transcriptsMigration from "../migrations/assistant_transcripts_initial.cjs";
import summaryMigration from "../migrations/assistant_transcripts_summary.cjs";
import { createRepository as createConversationsRepository } from "../src/server/repositories/conversationsRepository.js";
import { createRepository as createMessagesRepository } from "../src/server/repositories/messagesRepository.js";
import { createSqlConversationStorage } from "../src/server/sqlConversationStorage.js";

test("the SQL conversation storage keeps its contract, cache and summary on MySQL", {
  skip: !process.env.TEST_DB_NAME || !process.env.DB_HOST
}, async () => {
  const environment = process.env;
  const databaseName = `${environment.TEST_DB_NAME}_assistant_transcripts`;
  const connection = { host: environment.DB_HOST, port: Number(environment.DB_PORT), user: environment.DB_USER,
    password: environment.DB_PASSWORD };
  const admin = knex({ client: "mysql2", connection });
  const clients = [];
  const connect = () => {
    const db = knex({ client: "mysql2", connection: { ...connection, database: databaseName } });
    clients.push(db);
    const repositories = { conversationsRepository: createConversationsRepository(db), messagesRepository: createMessagesRepository(db) };
    return { db, ...repositories, storage: createSqlConversationStorage(repositories) };
  };
  try {
    await admin.raw("DROP DATABASE IF EXISTS ??", [databaseName]);
    await admin.raw("CREATE DATABASE ??", [databaseName]);
    const f = connect();
    await transcriptsMigration.up(f.db);
    await summaryMigration.up(f.db);
    await summaryMigration.up(f.db);
    const conversation = actor => f.conversationsRepository.create({ createdByUserId: actor, surfaceId: "assistant", metadata: {} });

    const first = await conversation("1");
    const other = await conversation("2");
    const scopes = new Map([["actor-a:workspace-a:conversation-a", first.id], ["actor-b:workspace-a:conversation-a", other.id]]);
    await verifyConversationStorageContract({
      read: (scope, callback) => f.storage.read(scopes.get(scope), callback),
      write: (scope, callback) => f.storage.write(scopes.get(scope), callback)
    }, { runtime: true });

    const long = await conversation("1");
    await f.storage.write(long.id, async transaction => {
      for (let index = 0; index < 100; index += 1) {
        const turnId = await transaction.nextTurnId();
        const at = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
        await transaction.appendMessage(turnId, { role: "user", messageId: `question-${index}`, text: `Question ${index}`, at });
        await transaction.appendMessage(turnId, { role: "assistant", messageId: `answer-${index}`, text: `Answer ${index}`, at });
      }
    });
    const servers = [connect(), connect()];
    for (const server of servers) await server.storage.read(long.id, transaction => transaction.listTurnIds());
    const queries = [];
    const listener = query => queries.push(query.sql);
    servers[0].db.on("query", listener);
    const appended = await Promise.all(servers.map((server, index) => server.storage.write(long.id, async transaction => {
      const turnId = await transaction.nextTurnId();
      await transaction.appendMessage(turnId, { role: "user", messageId: `concurrent-${index}`, text: `Concurrent ${index}`,
        at: "2026-02-01T00:00:00.000Z" });
      return turnId;
    })));
    servers[0].db.removeListener("query", listener);
    assert.deepEqual(appended.sort(), ["000101", "000102"], "Concurrent servers allocate distinct turns under the conversation lock");
    const wholeReads = queries.filter(sql => /from `assistant_messages`/u.test(sql) && /order by/u.test(sql));
    assert.ok(wholeReads.length <= 1, "Only a server that lost the race to the other's save reads the conversation again");
    for (const server of servers) {
      assert.deepEqual((await server.storage.read(long.id, transaction => transaction.listTurnIds())).slice(-2), ["000101", "000102"]);
    }

    const text = "A long summary. ".repeat(8_000);
    await servers[1].storage.write(long.id, transaction => transaction.writeSummary({ text, throughTurnId: "000100" }));
    const summarised = await servers[0].storage.read(long.id, async transaction => ({
      summary: await transaction.readSummary(), after: (await transaction.readTurnsAfter("000100")).map(turn => turn.turnId)
    }));
    assert.deepEqual(summarised, { summary: { text, throughTurnId: "000100" }, after: ["000101", "000102"] });

    await summaryMigration.down(f.db);
    for (const column of ["summary_text", "summary_through_turn_id", "transcript_revision"]) {
      assert.equal(await f.db.schema.hasColumn("assistant_conversations", column), false);
    }
    await summaryMigration.up(f.db);
    assert.equal(await f.db.schema.hasColumn("assistant_conversations", "transcript_revision"), true);
  } finally {
    for (const client of clients) await client.destroy();
    await admin.raw("DROP DATABASE IF EXISTS ??", [databaseName]);
    await admin.destroy();
  }
});
