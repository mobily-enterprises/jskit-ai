const UNIQUE_INDEX_NAME = "uq_chat_threads_workspace_thread_kind";

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable("chat_threads");
  if (!hasTable) {
    return;
  }

  await knex.schema.alterTable("chat_threads", (table) => {
    table.unique(["workspace_id", "thread_kind"], UNIQUE_INDEX_NAME);
  });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable("chat_threads");
  if (!hasTable) {
    return;
  }

  await knex.schema.alterTable("chat_threads", (table) => {
    table.dropUnique(["workspace_id", "thread_kind"], UNIQUE_INDEX_NAME);
  });
};
