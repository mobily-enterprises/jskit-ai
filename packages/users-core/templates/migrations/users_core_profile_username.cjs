const USERNAME_MAX_LENGTH = 120;

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, USERNAME_MAX_LENGTH);
}

function usernameBaseFromEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const localPart = normalizedEmail.includes("@") ? normalizedEmail.split("@")[0] : normalizedEmail;
  const username = normalizeUsername(localPart);
  return username || "user";
}

function buildUsernameCandidate(baseUsername, suffix) {
  const normalizedBase = normalizeUsername(baseUsername) || "user";
  if (suffix < 1) {
    return normalizedBase;
  }

  const suffixText = `-${suffix + 1}`;
  const allowedBaseLength = USERNAME_MAX_LENGTH - suffixText.length;
  const trimmedBase = normalizedBase.slice(0, allowedBaseLength);
  return `${trimmedBase}${suffixText}`;
}

function resolveUniqueUsername(baseUsername, usedUsernames) {
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = buildUsernameCandidate(baseUsername, suffix);
    if (!usedUsernames.has(candidate)) {
      return candidate;
    }
  }
  throw new Error("Unable to generate unique username for migration.");
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasUsersTable = await knex.schema.hasTable("users");
  if (!hasUsersTable) {
    return;
  }

  const hasUsername = await knex.schema.hasColumn("users", "username");
  if (hasUsername) {
    return;
  }

  await knex.schema.alterTable("users", (table) => {
    table.string("username", USERNAME_MAX_LENGTH).nullable();
  });

  const profiles = await knex("users").select(["id", "email"]).orderBy("id", "asc");
  const usedUsernames = new Set();

  for (const profile of profiles) {
    const nextUsername = resolveUniqueUsername(usernameBaseFromEmail(profile.email), usedUsernames);
    usedUsernames.add(nextUsername);
    await knex("users").where({ id: Number(profile.id) }).update({
      username: nextUsername
    });
  }

  await knex.schema.alterTable("users", (table) => {
    table.string("username", USERNAME_MAX_LENGTH).notNullable().alter();
  });

  await knex.schema.alterTable("users", (table) => {
    table.unique(["username"], "uq_users_username");
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const hasUsersTable = await knex.schema.hasTable("users");
  if (!hasUsersTable) {
    return;
  }

  const hasUsername = await knex.schema.hasColumn("users", "username");
  if (!hasUsername) {
    return;
  }

  await knex.schema.alterTable("users", (table) => {
    table.dropColumn("username");
  });
};
