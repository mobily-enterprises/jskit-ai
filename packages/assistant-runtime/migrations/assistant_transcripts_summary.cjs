// A long conversation keeps one compaction summary next to its messages, which are never
// deleted: the summary text and the last turn it covers. transcript_revision changes on
// every saved transcript change, so a server can keep reusing the rows it already read.
const COLUMNS = ["summary_text", "summary_through_turn_id", "transcript_revision"];

exports.up = async function up(knex) {
  const missing = [];
  for (const column of COLUMNS) {
    if (!await knex.schema.hasColumn("assistant_conversations", column)) missing.push(column);
  }
  if (!missing.length) return;
  await knex.schema.alterTable("assistant_conversations", table => {
    if (missing.includes("summary_text")) table.text("summary_text", "longtext").nullable();
    if (missing.includes("summary_through_turn_id")) table.string("summary_through_turn_id", 64).nullable();
    if (missing.includes("transcript_revision")) table.string("transcript_revision", 36).nullable();
  });
};

exports.down = async function down(knex) {
  const present = [];
  for (const column of COLUMNS) {
    if (await knex.schema.hasColumn("assistant_conversations", column)) present.push(column);
  }
  if (!present.length) return;
  await knex.schema.alterTable("assistant_conversations", table => {
    table.dropColumns(...present);
  });
};
