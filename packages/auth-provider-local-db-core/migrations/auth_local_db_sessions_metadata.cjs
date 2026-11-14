// Where and when each session was last seen: the address and browser of the request that signed it in, then of
// one that found it more than five minutes after it was last seen. Null when unknown, as for sessions from before.
const SESSIONS_TABLE = "auth_local_sessions";
const IP_MAX_LENGTH = 64;
const USER_AGENT_MAX_LENGTH = 512;

const COLUMNS = Object.freeze([
  ["ip", (table) => table.string("ip", IP_MAX_LENGTH).nullable()],
  ["user_agent", (table) => table.string("user_agent", USER_AGENT_MAX_LENGTH).nullable()],
  ["last_seen_at", (table) => table.timestamp("last_seen_at").nullable()]
]);

exports.up = async function up(knex) {
  for (const [name, add] of COLUMNS) {
    if (!(await knex.schema.hasColumn(SESSIONS_TABLE, name))) {
      await knex.schema.alterTable(SESSIONS_TABLE, add);
    }
  }
};

exports.down = async function down(knex) {
  for (const [name] of COLUMNS) {
    if (await knex.schema.hasColumn(SESSIONS_TABLE, name)) {
      await knex.schema.alterTable(SESSIONS_TABLE, (table) => {
        table.dropColumn(name);
      });
    }
  }
};
