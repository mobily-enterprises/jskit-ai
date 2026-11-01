// The agent's own tables. Each row belongs to a conversation by `conversation_id`, without a
// foreign key: the app says what a conversation is, adding the key (and any columns of its own)
// in its own migration.
exports.up = async function up(knex) {
  // A reply in progress, one per conversation, with the steps it has taken so far (runs.js).
  await knex.schema.createTable("agent_runs", (table) => {
    table.bigInteger("conversation_id").primary();
    table.timestamp("started_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("heartbeat_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.jsonb("steps");
    table.jsonb("input");
  });

  // Goals and their rounds (goals.js); one open goal per conversation.
  await knex.schema.createTable("agent_goals", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("conversation_id").notNullable();
    table.text("objective").notNullable();
    table.string("status", 12).notNullable().defaultTo("active");
    table.integer("rounds").notNullable().defaultTo(0);
    table.integer("max_rounds").notNullable().defaultTo(24);
    table.text("reason");
    table.string("time_zone", 64).notNullable().defaultTo("UTC");
    table.string("language", 40).notNullable().defaultTo("");
    // When the next round is due (null: none queued), and until when a server holds it.
    table.timestamp("round_at", { useTz: true });
    table.timestamp("lease_until", { useTz: true });
    table.integer("attempts").notNullable().defaultTo(0);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw("alter table agent_goals add constraint agent_goals_status check (status in ('active', 'paused', 'complete', 'blocked'))");
  await knex.raw("create unique index ux_agent_goals_open on agent_goals (conversation_id) where status in ('active', 'paused')");
  await knex.raw("create index ix_agent_goals_due on agent_goals (round_at) where round_at is not null");

  // Summaries between turns (summaryStore.js), and the conversations waiting for one.
  await knex.schema.createTable("agent_summaries", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("conversation_id").notNullable();
    // The newest message the summary covers; later messages are read as they are.
    table.bigInteger("covers_up_to").notNullable();
    table.text("summary").notNullable();
    table.integer("messages").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(["conversation_id", "id"], "ix_agent_summaries_latest");
  });
  await knex.schema.createTable("agent_summary_queue", (table) => {
    table.bigInteger("conversation_id").primary();
    table.timestamp("requested_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("run_after", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("lease_until", { useTz: true });
    table.integer("attempts").notNullable().defaultTo(0);
    table.text("last_error");
    table.index(["run_after"], "ix_agent_summary_queue_due");
  });

  // Commands run with the default tools (tools/commands.js).
  await knex.schema.createTable("agent_commands", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("conversation_id").notNullable();
    table.text("why").notNullable().defaultTo("");
    table.text("script").notNullable();
    table.string("status", 12).notNullable().defaultTo("running");
    table.integer("exit_code");
    table.text("output").notNullable().defaultTo("");
    table.boolean("truncated").notNullable().defaultTo(false);
    table.string("server", 128).notNullable();
    table.timestamp("heartbeat_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("started_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("ended_at", { useTz: true });
    table.index(["conversation_id", "id"], "ix_agent_commands_conversation");
  });
  await knex.raw("alter table agent_commands add constraint agent_commands_status check (status in ('running', 'done', 'failed', 'timed_out', 'stopped'))");
};

exports.down = async function down(knex) {
  for (const table of ["agent_commands", "agent_summary_queue", "agent_summaries", "agent_goals", "agent_runs"]) await knex.schema.dropTableIfExists(table);
};
