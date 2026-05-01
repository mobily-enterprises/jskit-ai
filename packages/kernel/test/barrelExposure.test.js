import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIRECTORY, "..", "..", "..");

const BARREL_EXPECTATIONS = Object.freeze([
  Object.freeze({
    filePath: path.join(REPO_ROOT, "packages", "kernel", "server", "runtime", "index.js"),
    expectedExports: Object.freeze([
      "AppError",
      "createValidationError",
      "installServiceRegistrationApi",
      "parsePositiveInteger",
      "requireAuth",
      "resolveServiceRegistrations",
      "registerDomainEventListener",
      "registerBootstrapPayloadContributor"
    ])
  }),
  Object.freeze({
    filePath: path.join(REPO_ROOT, "packages", "kernel", "shared", "support", "index.js"),
    expectedExports: Object.freeze([
      "appendQueryString",
      "formatDateTime",
      "hasPermission",
      "isRecord",
      "isTransientQueryError",
      "normalizePermissionList",
      "normalizeReturnToPath",
      "pickOwnProperties",
      "resolveAllowedOriginsFromPlacementContext",
      "splitPathQueryAndHash",
      "toCamelCase",
      "toSnakeCase",
      "shouldRetryTransientQueryFailure",
      "transientQueryRetryDelay"
    ])
  }),
  Object.freeze({
    filePath: path.join(REPO_ROOT, "packages", "kernel", "shared", "actions", "index.js"),
    expectedExports: Object.freeze([
      "normalizeActionDefinition",
      "withActionDefaults"
    ])
  }),
  Object.freeze({
    filePath: path.join(REPO_ROOT, "packages", "kernel", "shared", "validators", "index.js"),
    expectedExports: Object.freeze([
      "HTML_TIME_STRING_SCHEMA",
      "NULLABLE_HTML_TIME_STRING_SCHEMA",
      "RECORD_ID_PATTERN",
      "buildSchemaValidationError",
      "composeSchemaDefinitions",
      "createCursorListValidator",
      "createSchema",
      "cursorPaginationQueryValidator",
      "deriveRequiredFieldsFromSchema",
      "deriveResourceRequiredMetadata",
      "executeJsonRestSchemaDefinition",
      "hasJsonRestSchemaDefinition",
      "mergeObjectSchemas",
      "normalizeObjectInput",
      "normalizeRequiredFieldList",
      "normalizeSchemaDefinition",
      "normalizeSingleSchemaDefinition",
      "nullableRecordIdInputSchema",
      "nullableRecordIdSchema",
      "recordIdInputSchema",
      "recordIdParamsValidator",
      "recordIdSchema",
      "resolveSchemaTransportSchemaDefinition",
      "resolveStructuredSchemaTransportSchema",
      "validateSchemaPayload"
    ])
  }),
  Object.freeze({
    filePath: path.join(REPO_ROOT, "packages", "kernel", "client", "index.js"),
    expectedExports: Object.freeze([
      "bootstrapClientShellApp",
      "createComponentInteractionEmitter",
      "createShellRouter",
      "getClientAppConfig",
      "resolveClientBootstrapDebugEnabled"
    ])
  }),
  Object.freeze({
    filePath: path.join(REPO_ROOT, "packages", "kernel", "shared", "index.js"),
    expectedExports: Object.freeze([
      "normalizePathname",
      "resolveLinkPath"
    ])
  }),
  Object.freeze({
    filePath: path.join(REPO_ROOT, "packages", "kernel", "server", "http", "index.js"),
    expectedExports: Object.freeze([
      "registerRouteVisibilityResolver"
    ])
  })
]);

function collectBarrelNamedExports(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const exportMatches = [...source.matchAll(/export\s*\{([\s\S]*?)\}\s*from\s*["'][^"']+["']/g)];
  const names = [];

  for (const match of exportMatches) {
    const body = String(match[1] || "");
    for (const item of body.split(",")) {
      const entry = String(item || "").trim();
      if (!entry) {
        continue;
      }

      const alias = entry.split(/\sas\s/i).pop().trim();
      if (!alias) {
        continue;
      }
      names.push(alias);
    }
  }

  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

test("kernel barrel exports stay intentionally minimal", () => {
  for (const expectation of BARREL_EXPECTATIONS) {
    const observed = collectBarrelNamedExports(expectation.filePath);
    const expected = [...expectation.expectedExports].sort((left, right) => left.localeCompare(right));
    assert.deepEqual(
      observed,
      expected,
      `Unexpected barrel exports in ${path.relative(REPO_ROOT, expectation.filePath)}`
    );
  }
});
