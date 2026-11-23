// How each session was signed in, and when each account's credentials last changed, kept as they happened, for an
// action that asks more of the session that requests it. A session's sign_in_ip and sign_in_user_agent are the
// address and browser of the request that signed it in, written once (ip and user_agent are where it was last seen).
// An account's password_changed_at is when its password was last reset or changed, and email_changed_at when its
// email last changed to a confirmed address. Null when unknown, as for sessions and changes from before.
const SESSIONS_TABLE = "auth_local_sessions";
const USERS_TABLE = "auth_local_users";
const IP_MAX_LENGTH = 64;
const USER_AGENT_MAX_LENGTH = 512;

const COLUMNS = Object.freeze([
  [SESSIONS_TABLE, "sign_in_ip", (table) => table.string("sign_in_ip", IP_MAX_LENGTH).nullable()],
  [SESSIONS_TABLE, "sign_in_user_agent", (table) => table.string("sign_in_user_agent", USER_AGENT_MAX_LENGTH).nullable()],
  [USERS_TABLE, "password_changed_at", (table) => table.timestamp("password_changed_at").nullable()],
  [USERS_TABLE, "email_changed_at", (table) => table.timestamp("email_changed_at").nullable()]
]);

exports.up = async function up(knex) {
  for (const [tableName, name, add] of COLUMNS) {
    if (!(await knex.schema.hasColumn(tableName, name))) {
      await knex.schema.alterTable(tableName, add);
    }
  }
};

exports.down = async function down(knex) {
  for (const [tableName, name] of COLUMNS) {
    if (await knex.schema.hasColumn(tableName, name)) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropColumn(name);
      });
    }
  }
};
