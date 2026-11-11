// An application tool call's arguments are saved in its tool_call row's content_text, and a surface
// may allow up to 1 MiB of them (assistantServer.<surface>.maxToolArgumentBytes). MySQL's TEXT holds
// 64 KiB, so on MySQL and MariaDB content_text becomes LONGTEXT; PostgreSQL's and SQLite's text has
// no such limit and stays as it is.
exports.up = async function up(knex) {
  if (!/mysql|maria/iu.test(String(knex.client.config.client))) return;
  await knex.schema.alterTable("assistant_messages", table => {
    table.text("content_text", "longtext").nullable().alter();
  });
};

// Narrowing content_text back to TEXT would cut the arguments of longer saved calls, so it stays LONGTEXT.
exports.down = async function down() {};
