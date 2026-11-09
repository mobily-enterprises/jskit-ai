// Each summary names the summary it follows: the conversation's newest when it was saved, or none for its first. The
// database lets only one summary follow each, and only one be a conversation's first, so two servers that save a
// summary of one conversation at once, after reading the same newest, cannot both save one (summariesRepository.js).
exports.up = async function up(knex) {
  await knex.schema.alterTable("agent_summaries", (table) => {
    table.bigInteger("follows");
  });
  // A summary saved before follows the one before it in its conversation; the oldest kept follows none.
  await knex.raw(`
    update agent_summaries as summary set follows = earlier.id
    from (select id as later, lag(id) over (partition by conversation_id order by id) as id from agent_summaries) as earlier
    where summary.id = earlier.later and earlier.id is not null`);
  await knex.raw("create unique index ux_agent_summaries_follows on agent_summaries (conversation_id, follows) where follows is not null");
  await knex.raw("create unique index ux_agent_summaries_first on agent_summaries (conversation_id) where follows is null");
};

exports.down = async function down(knex) {
  await knex.raw("drop index if exists ux_agent_summaries_first");
  await knex.raw("drop index if exists ux_agent_summaries_follows");
  await knex.schema.alterTable("agent_summaries", (table) => {
    table.dropColumn("follows");
  });
};
