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

function requireCreateSchemaFieldsObject(programNode, variableName = "", context = "crud-server-generator scaffold-field") {
  const declaration = requireVariableDeclarator(programNode, variableName, context);
  const initExpression = declaration.init;
  if (!n.CallExpression.check(initExpression)) {
    throw new Error(`${context} expected ${variableName} to be initialized with createSchema(...).`);
  }
  if (!n.Identifier.check(initExpression.callee) || initExpression.callee.name !== "createSchema") {
    throw new Error(`${context} expected ${variableName} to call createSchema(...).`);
  }

  const firstArgument = initExpression.arguments?.[0];
  if (!n.ObjectExpression.check(firstArgument)) {
    throw new Error(`${context} expected ${variableName} createSchema first argument to be an object literal.`);
  }

  return firstArgument;
}

function unwrapObjectExpression(expressionNode, context = "crud-server-generator scaffold-field") {
  if (n.ObjectExpression.check(expressionNode)) {
    return expressionNode;
  }

  if (n.CallExpression.check(expressionNode)) {
    const callee = expressionNode.callee;
    const isFreezeCall =
      (n.Identifier.check(callee) && callee.name === "deepFreeze") ||
      (n.Identifier.check(callee) && callee.name === "defineCrudResource") ||
      (
        n.MemberExpression.check(callee) &&
        !callee.computed &&
        n.Identifier.check(callee.object) &&
        callee.object.name === "Object" &&
        n.Identifier.check(callee.property) &&
        callee.property.name === "freeze"
      );

    if (isFreezeCall && n.ObjectExpression.check(expressionNode.arguments?.[0])) {
      return expressionNode.arguments[0];
    }
  }

  throw new Error(`${context} expected object literal or freeze-wrapped object literal.`);
}

function requireResourceObject(programNode, variableName = "resource", context = "crud-server-generator scaffold-field") {
  const declaration = requireVariableDeclarator(programNode, variableName, context);
  return unwrapObjectExpression(declaration.init, context);
}

function resolveResourceSchemaObject(programNode, context = "crud-server-generator scaffold-field") {
  const resourceSchemaDeclaration = findVariableDeclarator(programNode, "resourceSchema");
  if (resourceSchemaDeclaration) {
    return unwrapObjectExpression(resourceSchemaDeclaration.init, context);
  }

  const resourceObject = requireResourceObject(programNode, "resource", context);
  const schemaProperty = findObjectPropertyByName(resourceObject, "schema");
  if (!schemaProperty || !schemaProperty.value) {
    throw new Error(`${context} could not find resource schema object.`);
  }

  return unwrapObjectExpression(schemaProperty.value, `${context} resource.schema`);
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
  const resourceObject = requireResourceObject(ast.program, "resource", context);
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
    outputSchemaExpression = "",
    createSchemaExpression = "",
    patchSchemaExpression = "",
    context = "crud-server-generator scaffold-field"
  } = {}
) {
  const normalizedFieldKey = normalizeText(fieldKey);
  if (!normalizedFieldKey) {
    throw new Error(`${context} apply patch requires fieldKey.`);
  }
  const hasCanonicalFieldExpression = Boolean(normalizeText(resourceSchemaExpression));
  const hasLegacyFieldExpressions =
    Boolean(normalizeText(outputSchemaExpression)) &&
    Boolean(normalizeText(createSchemaExpression)) &&
    Boolean(normalizeText(patchSchemaExpression));

  if (!hasCanonicalFieldExpression && !hasLegacyFieldExpressions) {
    throw new Error(
      `${context} apply patch requires resourceSchemaExpression or output/create/patch schema expressions.`
    );
  }

  const ast = parseModule(source, context);
  const programNode = ast.program;
  let changed = false;

  const hasCanonicalResourceSchema =
    Boolean(findVariableDeclarator(programNode, "resourceSchema")) ||
    Boolean(findObjectPropertyByName(requireResourceObject(programNode, "resource", context), "schema"));
  if (hasCanonicalResourceSchema) {
    if (!hasCanonicalFieldExpression) {
      throw new Error(`${context} resourceSchema patch requires resourceSchemaExpression.`);
    }

    const resourceSchemaObject = resolveResourceSchemaObject(programNode, context);
    changed =
      insertObjectProperty(resourceSchemaObject, normalizedFieldKey, resourceSchemaExpression, {
        context
      }) || changed;

    return {
      changed,
      content: changed ? recast.print(ast, { reuseWhitespace: true }).code : String(source || "")
    };
  }

  if (!hasLegacyFieldExpressions) {
    throw new Error(`${context} legacy resource patch requires output/create/patch schema expressions.`);
  }

  const recordOutputSchemaObject = requireCreateSchemaFieldsObject(programNode, "recordOutputSchema", context);
  changed =
    insertObjectProperty(recordOutputSchemaObject, normalizedFieldKey, outputSchemaExpression, {
      context,
      insertBeforeComputed: true
    }) || changed;

  const createBodySchemaObject = requireCreateSchemaFieldsObject(programNode, "createBodySchema", context);
  changed =
    insertObjectProperty(createBodySchemaObject, normalizedFieldKey, createSchemaExpression, {
      context
    }) || changed;

  const patchBodySchemaObject = requireCreateSchemaFieldsObject(programNode, "patchBodySchema", context);
  changed =
    insertObjectProperty(patchBodySchemaObject, normalizedFieldKey, patchSchemaExpression, {
      context
    }) || changed;

  return {
    changed,
    content: changed ? recast.print(ast, { reuseWhitespace: true }).code : String(source || "")
  };
}

export {
  resolveCrudResourceDefaults,
  applyCrudResourceFieldPatch
};
