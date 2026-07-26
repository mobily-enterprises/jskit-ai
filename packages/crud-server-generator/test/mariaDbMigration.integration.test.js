import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import knexFactory from "knex";
import { __testables } from "../src/server/buildTemplateContext.js";

const require = createRequire(import.meta.url);
const RUN_MARIADB_INTEGRATION =
  String(process.env.JSKIT_DATABASE_INTEGRATION_DRIVER || "").trim().toLowerCase() === "mariadb";

function createMariaDbKnex() {
  return knexFactory({
    client: "mysql2",
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    }
  });
}

function renderTemplate(source, replacements) {
  let rendered = source;
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.split(key).join(String(value));
  }
  return rendered;
}

async function loadRenderedMigration(tempRoot, fileName, templatePath, replacements) {
  const source = await readFile(templatePath, "utf8");
  const targetPath = path.join(tempRoot, fileName);
  await writeFile(targetPath, renderTemplate(source, replacements), "utf8");
  delete require.cache[targetPath];
  return require(targetPath);
}

test("generated MariaDB migrations rebuild mutual foreign keys from zero", {
  skip: RUN_MARIADB_INTEGRATION
    ? false
    : "set JSKIT_DATABASE_INTEGRATION_DRIVER=mariadb to run the cyclic foreign-key test",
  timeout: 120_000
}, async () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const templatesTable = `jskit_cycle_templates_${suffix}`;
  const versionsTable = `jskit_cycle_versions_${suffix}`;
  const currentVersionForeignKey = `fk_cycle_current_${suffix}`;
  const templateForeignKey = `fk_cycle_template_${suffix}`;
  const tempRoot = await mkdtemp(path.join(tmpdir(), "jskit-cycle-migrations-"));
  const knex = createMariaDbKnex();

  const dropFixtureTables = async () => {
    await knex.raw("SET FOREIGN_KEY_CHECKS = 0");
    try {
      await knex.schema.dropTableIfExists(versionsTable);
      await knex.schema.dropTableIfExists(templatesTable);
    } finally {
      await knex.raw("SET FOREIGN_KEY_CHECKS = 1");
    }
  };

  try {
    await dropFixtureTables();
    await knex.schema.createTable(templatesTable, (table) => {
      table.bigIncrements("id");
      table.bigInteger("current_version_id").unsigned().nullable();
    });
    await knex.schema.createTable(versionsTable, (table) => {
      table.bigIncrements("id");
      table.bigInteger("module_template_id").unsigned().notNullable();
    });
    await knex.schema.alterTable(templatesTable, (table) => {
      table
        .foreign(["current_version_id"], currentVersionForeignKey)
        .references(["id"])
        .inTable(versionsTable)
        .onDelete("SET NULL");
    });
    await knex.schema.alterTable(versionsTable, (table) => {
      table
        .foreign(["module_template_id"], templateForeignKey)
        .references(["id"])
        .inTable(templatesTable)
        .onDelete("CASCADE");
    });

    const { introspectCrudTableSnapshot } = await import(
      "@jskit-ai/database-runtime-mysql/shared"
    );
    const templatesSnapshot = await introspectCrudTableSnapshot(knex, {
      tableName: templatesTable
    });
    const versionsSnapshot = await introspectCrudTableSnapshot(knex, {
      tableName: versionsTable
    });
    const templatesReplacements = __testables.buildReplacementsFromSnapshot({
      namespace: templatesTable,
      snapshot: templatesSnapshot,
      resolvedOwnershipFilter: "public",
      surfaceRequiresWorkspace: false
    });
    const versionsReplacements = __testables.buildReplacementsFromSnapshot({
      namespace: versionsTable,
      snapshot: versionsSnapshot,
      resolvedOwnershipFilter: "public",
      surfaceRequiresWorkspace: false
    });

    const initialTemplate = path.resolve(
      "packages/crud-server-generator/templates/migrations/crud_initial.cjs"
    );
    const foreignKeyTemplate = path.resolve(
      "packages/crud-server-generator/templates/migrations/crud_foreign_keys.cjs"
    );
    const migrations = {
      templatesInitial: await loadRenderedMigration(
        tempRoot,
        "templates_initial.cjs",
        initialTemplate,
        templatesReplacements
      ),
      versionsInitial: await loadRenderedMigration(
        tempRoot,
        "versions_initial.cjs",
        initialTemplate,
        versionsReplacements
      ),
      templatesForeignKeys: await loadRenderedMigration(
        tempRoot,
        "templates_foreign_keys.cjs",
        foreignKeyTemplate,
        templatesReplacements
      ),
      versionsForeignKeys: await loadRenderedMigration(
        tempRoot,
        "versions_foreign_keys.cjs",
        foreignKeyTemplate,
        versionsReplacements
      )
    };

    await dropFixtureTables();
    await migrations.templatesInitial.up(knex);
    await migrations.versionsInitial.up(knex);
    await migrations.templatesForeignKeys.up(knex);
    await migrations.versionsForeignKeys.up(knex);

    const [rows] = await knex.raw(
      `
        SELECT COUNT(*) AS foreignKeyCount
        FROM information_schema.referential_constraints
        WHERE constraint_schema = DATABASE()
          AND constraint_name IN (?, ?)
      `,
      [currentVersionForeignKey, templateForeignKey]
    );
    assert.equal(Number(rows[0]?.foreignKeyCount), 2);

    await migrations.versionsForeignKeys.down(knex);
    await migrations.templatesForeignKeys.down(knex);
    await migrations.versionsInitial.down(knex);
    await migrations.templatesInitial.down(knex);
    assert.equal(await knex.schema.hasTable(templatesTable), false);
    assert.equal(await knex.schema.hasTable(versionsTable), false);
  } finally {
    await dropFixtureTables();
    await knex.destroy();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("generated MariaDB migration preserves TEXT-family column defaults", {
  skip: RUN_MARIADB_INTEGRATION
    ? false
    : "set JSKIT_DATABASE_INTEGRATION_DRIVER=mariadb to run the text-default test",
  timeout: 120_000
}, async () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const tableName = `jskit_text_defaults_${suffix}`;
  const tempRoot = await mkdtemp(path.join(tmpdir(), "jskit-text-default-migration-"));
  const knex = createMariaDbKnex();

  const readTextColumnMetadata = async () => {
    const [rows] = await knex.raw(
      `
        SELECT
          column_name AS columnName,
          data_type AS dataType,
          column_default AS columnDefault
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name <> 'id'
        ORDER BY ordinal_position
      `,
      [tableName]
    );
    return rows.map((row) => ({
      columnName: row.columnName,
      dataType: row.dataType,
      columnDefault: row.columnDefault
    }));
  };

  try {
    await knex.schema.dropTableIfExists(tableName);
    await knex.raw(
      `
        CREATE TABLE ?? (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          text_rules TEXT NOT NULL DEFAULT 'text-default',
          tinytext_rules TINYTEXT NOT NULL DEFAULT 'tiny-default',
          mediumtext_rules MEDIUMTEXT NOT NULL DEFAULT 'medium-default',
          due_date_rules_json LONGTEXT NOT NULL DEFAULT '[]'
        )
      `,
      [tableName]
    );

    const sourceMetadata = await readTextColumnMetadata();
    const { introspectCrudTableSnapshot } = await import(
      "@jskit-ai/database-runtime-mysql/shared"
    );
    const snapshot = await introspectCrudTableSnapshot(knex, {
      tableName
    });
    const replacements = __testables.buildReplacementsFromSnapshot({
      namespace: tableName,
      snapshot,
      resolvedOwnershipFilter: "public",
      surfaceRequiresWorkspace: false
    });
    assert.match(
      replacements.__JSKIT_CRUD_MIGRATION_COLUMN_LINES__,
      /table\.specificType\("due_date_rules_json", "longtext"\)\.notNullable\(\)\.defaultTo\("\[\]"\)/
    );

    const migration = await loadRenderedMigration(
      tempRoot,
      "text_defaults_initial.cjs",
      path.resolve("packages/crud-server-generator/templates/migrations/crud_initial.cjs"),
      replacements
    );

    await knex.schema.dropTable(tableName);
    await migration.up(knex);
    assert.deepEqual(await readTextColumnMetadata(), sourceMetadata);

    await knex.raw("INSERT INTO ?? () VALUES ()", [tableName]);
    const row = await knex(tableName)
      .select("text_rules", "tinytext_rules", "mediumtext_rules", "due_date_rules_json")
      .first();
    assert.deepEqual(row, {
      text_rules: "text-default",
      tinytext_rules: "tiny-default",
      mediumtext_rules: "medium-default",
      due_date_rules_json: "[]"
    });

    await migration.down(knex);
    assert.equal(await knex.schema.hasTable(tableName), false);
  } finally {
    await knex.schema.dropTableIfExists(tableName);
    await knex.destroy();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
