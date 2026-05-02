import * as recast from "recast";
import { parse as parseBabel } from "@babel/parser";
import { normalizeText } from "@jskit-ai/database-runtime/shared";

const { namedTypes: n, builders: b } = recast.types;

const BABEL_PARSE_PLUGINS = Object.freeze([
  "jsx",
  "importAssertions",
  "importAttributes",
  "dynamicImport",
  "classProperties",
  "classPrivateProperties",
  "classPrivateMethods",
  "optionalChaining",
  "nullishCoalescingOperator",
  "objectRestSpread",
  "topLevelAwait"
]);

const BABEL_REC_AST_PARSER = Object.freeze({
  parse(source, options = {}) {
    const sourcePlugins = Array.isArray(options?.plugins) ? options.plugins : [];
    const mergedPlugins = [...new Set([...sourcePlugins, ...BABEL_PARSE_PLUGINS])];
    return parseBabel(String(source || ""), {
      ...options,
      sourceType: "module",
      plugins: mergedPlugins
    });
  }
});

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const EXPLICIT_CRUD_SCHEMA_OVERRIDE_KEYS = Object.freeze([
  "body",
  "output",
  "listOutput",
  "listItemOutput",
  "createBody",
  "replaceBody",
  "patchBody",
  "deleteOutput"
]);

function isIdentifierName(value = "") {
  return IDENTIFIER_PATTERN.test(String(value || ""));
}

function parseModule(source = "", context = "crud-server-generator scaffold-field") {
  try {
    return recast.parse(String(source || ""), { parser: BABEL_REC_AST_PARSER });
  } catch (error) {
    throw new Error(
      `${context} could not parse resource file: ${String(error?.message || error || "unknown parse error")}`
    );
  }
}

function parseExpression(source = "", context = "crud-server-generator scaffold-field") {
  const expressionSource = `const __jskitFieldExpression = ${String(source || "")};`;
  const ast = parseModule(expressionSource, context);
  const statement = ast?.program?.body?.[0];
  if (!statement || !n.VariableDeclaration.check(statement)) {
    throw new Error(`${context} could not parse expression: ${String(source || "")}`);
  }
  const declaration = statement.declarations?.[0];
  if (!declaration || !n.VariableDeclarator.check(declaration) || !declaration.init) {
    throw new Error(`${context} could not resolve parsed expression: ${String(source || "")}`);
  }
  return declaration.init;
}

function resolveNodeKeyName(keyNode, { computed = false } = {}) {
  if (!keyNode) {
    return "";
  }
  if (!computed && n.Identifier.check(keyNode)) {
    return String(keyNode.name || "");
  }
  if (n.StringLiteral.check(keyNode) || n.Literal.check(keyNode)) {
    return String(keyNode.value || "");
  }
  return "";
}

function createObjectPropertyKeyNode(key = "") {
  const normalizedKey = String(key || "");
  if (isIdentifierName(normalizedKey)) {
    return b.identifier(normalizedKey);
  }
  return b.stringLiteral(normalizedKey);
}

function findVariableDeclarator(programNode, variableName = "") {
  const targetName = normalizeText(variableName);
  if (!targetName || !programNode || !Array.isArray(programNode.body)) {
    return null;
  }

  for (const statement of programNode.body) {
    if (!n.VariableDeclaration.check(statement)) {
      continue;
    }
    for (const declaration of statement.declarations || []) {
      if (!n.VariableDeclarator.check(declaration) || !n.Identifier.check(declaration.id)) {
        continue;
      }
      if (declaration.id.name === targetName) {
        return declaration;
      }
    }
  }

  return null;
}

function requireVariableDeclarator(programNode, variableName = "", context = "crud-server-generator scaffold-field") {
  const declaration = findVariableDeclarator(programNode, variableName);
  if (declaration) {
    return declaration;
  }
  throw new Error(`${context} could not find const ${variableName}.`);
}

function requireCrudResourceConfigObject(programNode, context = "crud-server-generator scaffold-field") {
  const declaration = requireVariableDeclarator(programNode, "resource", context);
  const initExpression = declaration.init;
  if (!n.CallExpression.check(initExpression)) {
    throw new Error(
      `${context} requires resource files authored as const resource = defineCrudResource({ ... }).`
    );
  }
  if (!n.Identifier.check(initExpression.callee) || initExpression.callee.name !== "defineCrudResource") {
    throw new Error(
      `${context} requires resource files authored as const resource = defineCrudResource({ ... }).`
    );
  }

  const firstArgument = initExpression.arguments?.[0];
  if (!n.ObjectExpression.check(firstArgument)) {
    throw new Error(
      `${context} requires defineCrudResource(...) to receive an inline object literal.`
    );
  }

  return firstArgument;
}

function requireResourceSchemaObject(programNode, context = "crud-server-generator scaffold-field") {
  const resourceObject = requireCrudResourceConfigObject(programNode, context);
  assertNoExplicitCrudSchemaOverrides(resourceObject, context);
  const schemaProperty = findObjectPropertyByName(resourceObject, "schema");
  if (!schemaProperty || !n.ObjectExpression.check(schemaProperty.value)) {
    throw new Error(
      `${context} requires defineCrudResource({ ..., schema: { ... } }) with an inline schema object literal.`
    );
  }

  return schemaProperty.value;
}

function assertNoExplicitCrudSchemaOverrides(resourceObject, context = "crud-server-generator scaffold-field") {
  const crudProperty = findObjectPropertyByName(resourceObject, "crud");
  if (!crudProperty) {
    return;
  }

  if (!n.ObjectExpression.check(crudProperty.value)) {
    throw new Error(
      `${context} cannot patch defineCrudResource({ ..., crud: ... }) unless crud is omitted or authored as an inline object literal without explicit schema overrides.`
    );
  }

  const overrideKeys = EXPLICIT_CRUD_SCHEMA_OVERRIDE_KEYS.filter((propertyName) =>
    hasObjectProperty(crudProperty.value, propertyName)
  );
  if (overrideKeys.length === 0) {
    return;
  }

  throw new Error(
    `${context} cannot patch defineCrudResource({ ..., crud: { ... } }) when explicit crud schema overrides are authored (${overrideKeys.join(", ")}). Update schema and override validators manually.`
  );
}

function findObjectPropertyByName(objectNode, propertyName = "") {
  const targetName = normalizeText(propertyName);
  if (!targetName || !n.ObjectExpression.check(objectNode)) {
    return null;
  }

  for (const property of objectNode.properties || []) {
    if (!n.ObjectProperty.check(property) && !n.Property.check(property) && !n.ObjectMethod.check(property)) {
      continue;
    }
    const name = resolveNodeKeyName(property.key, {
      computed: Boolean(property.computed)
    });
    if (name === targetName) {
      return property;
    }
  }

  return null;
}

function hasObjectProperty(objectNode, propertyName = "") {
  return Boolean(findObjectPropertyByName(objectNode, propertyName));
}

function insertObjectProperty(
  objectNode,
  propertyName = "",
  valueExpressionSource = "",
  {
    context = "crud-server-generator scaffold-field",
    insertBeforeComputed = false
  } = {}
) {
  if (!n.ObjectExpression.check(objectNode)) {
    throw new Error(`${context} expected object expression while inserting property "${propertyName}".`);
  }

  const key = normalizeText(propertyName);
  if (!key) {
    throw new Error(`${context} insertObjectProperty requires propertyName.`);
  }

  if (hasObjectProperty(objectNode, key)) {
    return false;
  }

  const valueNode = parseExpression(valueExpressionSource, context);
  const propertyNode = b.objectProperty(createObjectPropertyKeyNode(key), valueNode);
  const firstComputedIndex = insertBeforeComputed
    ? objectNode.properties.findIndex((property) => Boolean(property?.computed))
    : -1;
  const insertionIndex =
    insertBeforeComputed && firstComputedIndex >= 0
      ? firstComputedIndex
      : objectNode.properties.length;

  if (insertionIndex >= 0 && insertionIndex < objectNode.properties.length) {
    objectNode.properties.splice(insertionIndex, 0, propertyNode);
  } else {
    objectNode.properties.push(propertyNode);
  }

  return true;
}

function resolveObjectPropertyStringValue(objectNode, propertyName = "") {
  const propertyNode = findObjectPropertyByName(objectNode, propertyName);
  if (!propertyNode) {
    return "";
  }
  const valueNode = propertyNode.value;
  if (n.StringLiteral.check(valueNode)) {
    return String(valueNode.value || "");
  }
  if (n.Literal.check(valueNode) && typeof valueNode.value === "string") {
    return String(valueNode.value || "");
  }
  return "";
}

function resolveCrudResourceDefaults(source = "", context = "crud-server-generator scaffold-field") {
  const ast = parseModule(source, context);
  const resourceObject = requireCrudResourceConfigObject(ast.program, context);
  const tableName = resolveObjectPropertyStringValue(resourceObject, "tableName");
  if (!tableName) {
    throw new Error(`${context} could not resolve resource tableName from resource object literal.`);
  }
  const idColumn = resolveObjectPropertyStringValue(resourceObject, "idColumn") || "id";
  return Object.freeze({
    tableName,
    idColumn
  });
}

function applyCrudResourceFieldPatch(
  source = "",
  {
    fieldKey = "",
    resourceSchemaExpression = "",
    context = "crud-server-generator scaffold-field"
  } = {}
) {
  const normalizedFieldKey = normalizeText(fieldKey);
  if (!normalizedFieldKey) {
    throw new Error(`${context} apply patch requires fieldKey.`);
  }
  const hasCanonicalFieldExpression = Boolean(normalizeText(resourceSchemaExpression));
  if (!hasCanonicalFieldExpression) {
    throw new Error(
      `${context} apply patch requires resourceSchemaExpression.`
    );
  }

  const ast = parseModule(source, context);
  const programNode = ast.program;
  const resourceSchemaObject = requireResourceSchemaObject(programNode, context);
  const changed = insertObjectProperty(resourceSchemaObject, normalizedFieldKey, resourceSchemaExpression, {
    context
  });

  return {
    changed,
    content: changed ? recast.print(ast, { reuseWhitespace: true }).code : String(source || "")
  };
}

export {
  resolveCrudResourceDefaults,
  applyCrudResourceFieldPatch
};
