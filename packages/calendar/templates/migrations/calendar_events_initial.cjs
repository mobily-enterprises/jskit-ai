// JSKIT_MIGRATION_ID: calendar_events_initial

exports.up = async function up(knex) {
  const hasContactsTable = await knex.schema.hasTable("contacts");
  if (!hasContactsTable) {
    throw new Error("calendar_events requires contacts table. Install @jskit-ai/crud first.");
  }

  const hasCalendarEventsTable = await knex.schema.hasTable("calendar_events");
  if (hasCalendarEventsTable) {
    return;
  }

  await knex.schema.createTable("calendar_events", (table) => {
    table.increments("id").unsigned().primary();
    table.integer("workspace_owner_id").unsigned().nullable().index();
    table.integer("user_owner_id").unsigned().nullable().index();
    table.integer("contact_id").unsigned().notNullable().references("id").inTable("contacts").onDelete("CASCADE");
    table.string("title", 200).notNullable();
    table.text("notes").notNullable().defaultTo("");
    table.timestamp("starts_at").notNullable().index();
    table.timestamp("ends_at").notNullable().index();
    table.string("status", 32).notNullable().defaultTo("scheduled");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());

    table.index(["workspace_owner_id", "starts_at"], "idx_calendar_events_workspace_start");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("calendar_events");
};
