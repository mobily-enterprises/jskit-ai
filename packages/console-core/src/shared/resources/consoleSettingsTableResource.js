import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

// console_settings: the application's one console settings record (id 1, seeded by the migration), naming the user
// who owns the console. It belongs to the whole application, not to a workspace or user, so the table is public; the
// console feature owns it and only its repository reads or writes it.
const consoleSettingsTableResource = defineTableResource({
  name: "consoleSettings",
  tableName: "console_settings",
  ownership: "public",
  foreignKeys: [{ columns: ["ownerUserId"], referencedTableName: "users" }],
  schema: {
    ownerUserId: { type: "id", nullable: true },
    createdAt: { type: "dateTime", storage: { writeSerializer: "datetime-utc" } },
    updatedAt: { type: "dateTime", storage: { writeSerializer: "datetime-utc" } }
  }
});

export { consoleSettingsTableResource };
