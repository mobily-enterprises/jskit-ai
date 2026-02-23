const LEGACY_LIMITATION_CODE = "annuity.calculations.monthly";
const DEG2RAD_LIMITATION_CODE = "deg2rad.calculations.monthly";
const LEGACY_REASON_CODE = "annuity.calculate";
const DEG2RAD_REASON_CODE = "deg2rad.calculate";
const LEGACY_NAME = "Annuity Calculations Monthly";
const DEG2RAD_NAME = "DEG2RAD Calculations Monthly";
const LEGACY_DESCRIPTION = "Monthly quota for annuity calculations.";
const DEG2RAD_DESCRIPTION = "Monthly quota for DEG2RAD calculations.";

const TABLE_NAMES = Object.freeze({
  definitions: "billing_entitlement_definitions",
  planTemplates: "billing_plan_entitlement_templates",
  productTemplates: "billing_product_entitlement_templates",
  grants: "billing_entitlement_grants",
  consumptions: "billing_entitlement_consumptions",
  balances: "billing_entitlement_balances"
});

async function resolveTablePresence(knex) {
  const entries = await Promise.all(
    Object.entries(TABLE_NAMES).map(async ([key, tableName]) => [key, await knex.schema.hasTable(tableName)])
  );
  return Object.fromEntries(entries);
}

async function findDefinitionByCode(trx, code) {
  return trx(TABLE_NAMES.definitions).where({ code }).select("id", "code").first();
}

function buildDefinitionUpdatePatch(trx, { code, name, description, capabilityCode }) {
  return {
    code,
    name,
    description,
    metadata_json: trx.raw("JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.capability', JSON_ARRAY(?))", [
      capabilityCode
    ]),
    updated_at: trx.raw("UTC_TIMESTAMP(3)")
  };
}

async function normalizeDefinitionRow(trx, definitionId, { code, name, description, capabilityCode }) {
  await trx(TABLE_NAMES.definitions)
    .where({ id: Number(definitionId) })
    .update(buildDefinitionUpdatePatch(trx, { code, name, description, capabilityCode }));
}

async function dedupeAndRepointReferences(trx, tables, { fromDefinitionId, toDefinitionId }) {
  const sourceId = Number(fromDefinitionId);
  const targetId = Number(toDefinitionId);

  if (tables.planTemplates) {
    await trx.raw(
      `
        DELETE source
        FROM billing_plan_entitlement_templates source
        INNER JOIN billing_plan_entitlement_templates target
          ON target.plan_id = source.plan_id
         AND target.grant_kind = source.grant_kind
         AND target.entitlement_definition_id = ?
        WHERE source.entitlement_definition_id = ?
      `,
      [targetId, sourceId]
    );

    await trx(TABLE_NAMES.planTemplates)
      .where({ entitlement_definition_id: sourceId })
      .update({
        entitlement_definition_id: targetId,
        updated_at: trx.raw("UTC_TIMESTAMP(3)")
      });
  }

  if (tables.productTemplates) {
    await trx.raw(
      `
        DELETE source
        FROM billing_product_entitlement_templates source
        INNER JOIN billing_product_entitlement_templates target
          ON target.billing_product_id = source.billing_product_id
         AND target.grant_kind = source.grant_kind
         AND target.entitlement_definition_id = ?
        WHERE source.entitlement_definition_id = ?
      `,
      [targetId, sourceId]
    );

    await trx(TABLE_NAMES.productTemplates)
      .where({ entitlement_definition_id: sourceId })
      .update({
        entitlement_definition_id: targetId,
        updated_at: trx.raw("UTC_TIMESTAMP(3)")
      });
  }

  if (tables.balances) {
    await trx.raw(
      `
        DELETE source
        FROM billing_entitlement_balances source
        INNER JOIN billing_entitlement_balances target
          ON target.subject_type = source.subject_type
         AND target.subject_id = source.subject_id
         AND target.window_start_at = source.window_start_at
         AND target.window_end_at = source.window_end_at
         AND target.entitlement_definition_id = ?
        WHERE source.entitlement_definition_id = ?
      `,
      [targetId, sourceId]
    );

    await trx(TABLE_NAMES.balances)
      .where({ entitlement_definition_id: sourceId })
      .update({
        entitlement_definition_id: targetId,
        updated_at: trx.raw("UTC_TIMESTAMP(3)")
      });
  }

  if (tables.grants) {
    await trx(TABLE_NAMES.grants).where({ entitlement_definition_id: sourceId }).update({
      entitlement_definition_id: targetId
    });
  }

  if (tables.consumptions) {
    await trx(TABLE_NAMES.consumptions).where({ entitlement_definition_id: sourceId }).update({
      entitlement_definition_id: targetId
    });
  }
}

async function migrateLimitationCode(
  trx,
  tables,
  {
    sourceCode,
    sourceName,
    sourceDescription,
    sourceCapabilityCode,
    targetCode,
    targetName,
    targetDescription,
    targetCapabilityCode
  }
) {
  const sourceDefinition = await findDefinitionByCode(trx, sourceCode);
  const targetDefinition = await findDefinitionByCode(trx, targetCode);

  if (!sourceDefinition && !targetDefinition) {
    return;
  }

  if (sourceDefinition && !targetDefinition) {
    await normalizeDefinitionRow(trx, sourceDefinition.id, {
      code: targetCode,
      name: targetName,
      description: targetDescription,
      capabilityCode: targetCapabilityCode
    });
    return;
  }

  if (!sourceDefinition && targetDefinition) {
    await normalizeDefinitionRow(trx, targetDefinition.id, {
      code: targetCode,
      name: targetName,
      description: targetDescription,
      capabilityCode: targetCapabilityCode
    });
    return;
  }

  await dedupeAndRepointReferences(trx, tables, {
    fromDefinitionId: sourceDefinition.id,
    toDefinitionId: targetDefinition.id
  });

  await trx(TABLE_NAMES.definitions).where({ id: Number(sourceDefinition.id) }).del();

  await normalizeDefinitionRow(trx, targetDefinition.id, {
    code: targetCode,
    name: targetName,
    description: targetDescription,
    capabilityCode: targetCapabilityCode
  });

  if (sourceName || sourceDescription || sourceCapabilityCode) {
    // no-op placeholder to keep parameter symmetry explicit for down migration intent
  }
}

async function migrateConsumptionReasonCode(trx, tables, { sourceReasonCode, targetReasonCode }) {
  if (!tables.consumptions) {
    return;
  }

  await trx(TABLE_NAMES.consumptions)
    .where({ reason_code: sourceReasonCode })
    .update({ reason_code: targetReasonCode });

  await trx.raw(
    `
      UPDATE billing_entitlement_consumptions
      SET metadata_json = CASE
        WHEN JSON_UNQUOTE(JSON_EXTRACT(COALESCE(metadata_json, JSON_OBJECT()), '$.capability[0]')) = ?
          THEN JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.capability', JSON_ARRAY(?))
        WHEN JSON_UNQUOTE(JSON_EXTRACT(COALESCE(metadata_json, JSON_OBJECT()), '$.capability')) = ?
          THEN JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.capability', ?)
        ELSE metadata_json
      END
      WHERE JSON_UNQUOTE(JSON_EXTRACT(COALESCE(metadata_json, JSON_OBJECT()), '$.capability[0]')) = ?
         OR JSON_UNQUOTE(JSON_EXTRACT(COALESCE(metadata_json, JSON_OBJECT()), '$.capability')) = ?
    `,
    [
      sourceReasonCode,
      targetReasonCode,
      sourceReasonCode,
      targetReasonCode,
      sourceReasonCode,
      sourceReasonCode
    ]
  );
}

exports.up = async function up(knex) {
  const tables = await resolveTablePresence(knex);
  if (!tables.definitions) {
    return;
  }

  await knex.transaction(async (trx) => {
    await migrateLimitationCode(trx, tables, {
      sourceCode: LEGACY_LIMITATION_CODE,
      sourceName: LEGACY_NAME,
      sourceDescription: LEGACY_DESCRIPTION,
      sourceCapabilityCode: LEGACY_REASON_CODE,
      targetCode: DEG2RAD_LIMITATION_CODE,
      targetName: DEG2RAD_NAME,
      targetDescription: DEG2RAD_DESCRIPTION,
      targetCapabilityCode: DEG2RAD_REASON_CODE
    });

    await migrateConsumptionReasonCode(trx, tables, {
      sourceReasonCode: LEGACY_REASON_CODE,
      targetReasonCode: DEG2RAD_REASON_CODE
    });
  });
};

exports.down = async function down(knex) {
  const tables = await resolveTablePresence(knex);
  if (!tables.definitions) {
    return;
  }

  await knex.transaction(async (trx) => {
    await migrateLimitationCode(trx, tables, {
      sourceCode: DEG2RAD_LIMITATION_CODE,
      sourceName: DEG2RAD_NAME,
      sourceDescription: DEG2RAD_DESCRIPTION,
      sourceCapabilityCode: DEG2RAD_REASON_CODE,
      targetCode: LEGACY_LIMITATION_CODE,
      targetName: LEGACY_NAME,
      targetDescription: LEGACY_DESCRIPTION,
      targetCapabilityCode: LEGACY_REASON_CODE
    });

    await migrateConsumptionReasonCode(trx, tables, {
      sourceReasonCode: DEG2RAD_REASON_CODE,
      targetReasonCode: LEGACY_REASON_CODE
    });
  });
};
