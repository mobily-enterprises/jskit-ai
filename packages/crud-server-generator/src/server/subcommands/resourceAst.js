import * as recast from "recast";
import { parse as parseBabel } from "@babel/parser";
import { normalizeText } from "@jskit-ai/database-runtime/shared";
import { normalizeCrudLookupNamespace } from "@jskit-ai/kernel/shared/support/crudLookup";

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

function parseStatement(source = "", context = "crud-server-generator scaffold-field") {
  const ast = parseModule(String(source || ""), context);
  const statement = ast?.program?.body?.[0];
  if (!statement) {
    throw new Error(`${context} could not parse statement.`);
  }
  return statement;
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

function requireSchemaPropertiesObject(programNode, variableName = "", context = "crud-server-generator scaffold-field") {
  const declaration = requireVariableDeclarator(programNode, variableName, context);
  const initExpression = declaration.init;
  if (!n.CallExpression.check(initExpression)) {
    throw new Error(`${context} expected ${variableName} to be initialized with Type.Object(...).`);
  }

  const callee = initExpression.callee;
  const isTypeObjectCall =
    n.MemberExpression.check(callee) &&
    !callee.computed &&
    n.Identifier.check(callee.object) &&
    callee.object.name === "Type" &&
    n.Identifier.check(callee.property) &&
    callee.property.name === "Object";
  if (!isTypeObjectCall) {
    throw new Error(`${context} expected ${variableName} to call Type.Object(...).`);
  }

  const firstArgument = initExpression.arguments?.[0];
  if (!n.ObjectExpression.check(firstArgument)) {
    throw new Error(`${context} expected ${variableName} Type.Object first argument to be an object literal.`);
  }

  return firstArgument;
}

function requireObjectFreezePayloadObject(programNode, variableName = "", context = "crud-server-generator scaffold-field") {
  const declaration = requireVariableDeclarator(programNode, variableName, context);
  const initExpression = declaration.init;
  if (!n.CallExpression.check(initExpression)) {
    throw new Error(`${context} expected ${variableName} to be initialized with Object.freeze(...).`);
  }

  const callee = initExpression.callee;
  const isObjectFreezeCall =
    n.MemberExpression.check(callee) &&
    !callee.computed &&
    n.Identifier.check(callee.object) &&
    callee.object.name === "Object" &&
    n.Identifier.check(callee.property) &&
    callee.property.name === "freeze";
  if (!isObjectFreezeCall) {
    throw new Error(`${context} expected ${variableName} to call Object.freeze(...).`);
  }

  const payload = initExpression.arguments?.[0];
  if (!n.ObjectExpression.check(payload)) {
    throw new Error(`${context} expected ${variableName} Object.freeze payload to be an object literal.`);
  }

  return payload;
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

function requireNormalizeFunctionBody(programNode, variableName = "", context = "crud-server-generator scaffold-field") {
  const validatorObject = requireObjectFreezePayloadObject(programNode, variableName, context);
  const normalizeProperty = findObjectPropertyByName(validatorObject, "normalize");
  if (!normalizeProperty) {
    throw new Error(`${context} expected ${variableName}.normalize(...) to exist.`);
  }

  if (n.ObjectMethod.check(normalizeProperty)) {
    return normalizeProperty.body;
  }

  const propertyValue = normalizeProperty.value;
  if (n.FunctionExpression.check(propertyValue) || n.ArrowFunctionExpression.check(propertyValue)) {
    if (n.BlockStatement.check(propertyValue.body)) {
      return propertyValue.body;
    }
  }

  throw new Error(`${context} expected ${variableName}.normalize to be a function with a block body.`);
}

function requireNormalizedObjectLiteral(functionBody, context = "crud-server-generator scaffold-field") {
  for (const statement of functionBody.body || []) {
    if (!n.VariableDeclaration.check(statement)) {
      continue;
    }
    for (const declaration of statement.declarations || []) {
      if (!n.VariableDeclarator.check(declaration) || !n.Identifier.check(declaration.id)) {
        continue;
      }
      if (declaration.id.name !== "normalized") {
        continue;
      }
      if (!n.ObjectExpression.check(declaration.init)) {
        throw new Error(`${context} expected normalized to be initialized as an object literal.`);
      }
      return declaration.init;
    }
  }
  throw new Error(`${context} could not find "const normalized = { ... }".`);
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

function hasNormalizeIfInSourceCall(functionBody, fieldKey = "") {
  const targetFieldKey = normalizeText(fieldKey);
  if (!targetFieldKey) {
    return false;
  }

  for (const statement of functionBody.body || []) {
    if (!n.ExpressionStatement.check(statement) || !n.CallExpression.check(statement.expression)) {
      continue;
    }
    const callExpression = statement.expression;
    if (!n.Identifier.check(callExpression.callee) || callExpression.callee.name !== "normalizeIfInSource") {
      continue;
    }
    const keyArgument = callExpression.arguments?.[2];
    if (n.StringLiteral.check(keyArgument) && normalizeText(keyArgument.value) === targetFieldKey) {
      return true;
    }
    if (n.Literal.check(keyArgument) && typeof keyArgument.value === "string" && normalizeText(keyArgument.value) === targetFieldKey) {
      return true;
    }
  }

  return false;
}

function resolveReturnNormalizedIndex(functionBody) {
  const statements = Array.isArray(functionBody?.body) ? functionBody.body : [];
  for (const [index, statement] of statements.entries()) {
    if (!n.ReturnStatement.check(statement)) {
      continue;
    }
    if (n.Identifier.check(statement.argument) && statement.argument.name === "normalized") {
      return index;
    }
  }
  return statements.length;
}

function hasResourceFieldMetaEntry(programNode, fieldKey = "") {
  const targetKey = normalizeText(fieldKey);
  if (!targetKey || !programNode || !Array.isArray(programNode.body)) {
    return false;
  }

  for (const statement of programNode.body) {
    if (!n.ExpressionStatement.check(statement) || !n.CallExpression.check(statement.expression)) {
      continue;
    }
    const callExpression = statement.expression;
    if (!n.MemberExpression.check(callExpression.callee) || callExpression.callee.computed) {
      continue;
    }
    if (!n.Identifier.check(callExpression.callee.object) || callExpression.callee.object.name !== "RESOURCE_FIELD_META") {
      continue;
    }
    if (!n.Identifier.check(callExpression.callee.property) || callExpression.callee.property.name !== "push") {
      continue;
    }

    const firstArgument = callExpression.arguments?.[0];
    if (!n.ObjectExpression.check(firstArgument)) {
      continue;
    }
    const keyProperty = findObjectPropertyByName(firstArgument, "key");
    if (!keyProperty) {
      continue;
    }
    const keyValue = keyProperty.value;
    if (n.StringLiteral.check(keyValue) && normalizeText(keyValue.value) === targetKey) {
      return true;
    }
    if (n.Literal.check(keyValue) && typeof keyValue.value === "string" && normalizeText(keyValue.value) === targetKey) {
      return true;
    }
  }

  return false;
}

function sortImportSpecifiers(importDeclaration) {
  const sourceSpecifiers = Array.isArray(importDeclaration?.specifiers) ? importDeclaration.specifiers : [];
  const named = sourceSpecifiers
    .filter((specifier) => n.ImportSpecifier.check(specifier))
    .sort((left, right) => {
      const leftName = String(left?.imported?.name || left?.imported?.value || "");
      const rightName = String(right?.imported?.name || right?.imported?.value || "");
      return leftName.localeCompare(rightName);
    });
  const nonNamed = sourceSpecifiers.filter((specifier) => !n.ImportSpecifier.check(specifier));
  importDeclaration.specifiers = [...nonNamed, ...named];
}

function ensureNamedImport(programNode, modulePath = "", importName = "") {
  const normalizedModulePath = normalizeText(modulePath);
  const normalizedImportName = normalizeText(importName);
  if (!normalizedModulePath || !normalizedImportName) {
    return false;
  }

  const importDeclarations = (programNode.body || []).filter((statement) => n.ImportDeclaration.check(statement));
  let declaration = importDeclarations.find((statement) => {
    const source = statement.source;
    if (n.StringLiteral.check(source)) {
      return source.value === normalizedModulePath;
    }
    if (n.Literal.check(source)) {
      return source.value === normalizedModulePath;
    }
    return false;
  });

  if (!declaration) {
    declaration = b.importDeclaration(
      [b.importSpecifier(b.identifier(normalizedImportName), b.identifier(normalizedImportName))],
      b.stringLiteral(normalizedModulePath)
    );
    const insertionIndex = (() => {
      const body = Array.isArray(programNode.body) ? programNode.body : [];
      let index = 0;
      while (index < body.length && n.ImportDeclaration.check(body[index])) {
        index += 1;
      }
      return index;
    })();
    programNode.body.splice(insertionIndex, 0, declaration);
    return true;
  }

  const hasSpecifier = (declaration.specifiers || []).some((specifier) => {
    if (!n.ImportSpecifier.check(specifier)) {
      return false;
    }
    const importedName = String(specifier.imported?.name || specifier.imported?.value || "");
    const localName = String(specifier.local?.name || "");
    return importedName === normalizedImportName || localName === normalizedImportName;
  });
  if (hasSpecifier) {
    return false;
  }

  declaration.specifiers = [
    ...(declaration.specifiers || []),
    b.importSpecifier(b.identifier(normalizedImportName), b.identifier(normalizedImportName))
  ];
  sortImportSpecifiers(declaration);
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
  const statements = Array.isArray(ast?.program?.body) ? ast.program.body : [];

  for (const statement of statements) {
    if (!n.VariableDeclaration.check(statement)) {
      continue;
    }
    for (const declaration of statement.declarations || []) {
      if (!n.VariableDeclarator.check(declaration) || !n.ObjectExpression.check(declaration.init)) {
        continue;
      }
      const tableName = resolveObjectPropertyStringValue(declaration.init, "tableName");
      if (!tableName) {
        continue;
      }
      const idColumn = resolveObjectPropertyStringValue(declaration.init, "idColumn");
      return Object.freeze({
        tableName,
        idColumn: idColumn || "id"
      });
    }
  }

  throw new Error(`${context} could not resolve resource tableName/idColumn from resource object literal.`);
}

function renderResourceFieldMetaPushStatement(entry = {}) {
  const key = normalizeText(entry?.key);
  if (!key) {
    throw new Error("crud-server-generator scaffold-field fieldMeta entry requires key.");
  }

  const lines = ["RESOURCE_FIELD_META.push({"];
  lines.push(`  key: ${JSON.stringify(key)},`);

  const repositoryColumn = normalizeText(entry?.repository?.column);
  if (repositoryColumn) {
    lines.push("  repository: {");
    lines.push(`    column: ${JSON.stringify(repositoryColumn)}`);
    lines.push("  },");
  }

  const relation = entry?.relation && typeof entry.relation === "object" ? entry.relation : null;
  if (relation) {
    const relationNamespace =
      normalizeCrudLookupNamespace(relation.namespace) ||
      normalizeCrudLookupNamespace(relation.apiPath);
    if (!relationNamespace) {
      throw new Error("crud-server-generator scaffold-field fieldMeta relation requires namespace.");
    }
    lines.push("  relation: {");
    lines.push(`    kind: ${JSON.stringify(normalizeText(relation.kind) || "lookup")},`);
    lines.push(`    namespace: ${JSON.stringify(relationNamespace)},`);
    lines.push(`    valueKey: ${JSON.stringify(normalizeText(relation.valueKey) || "id")}`);
    lines.push("  },");
  }

  const formControl = normalizeText(entry?.ui?.formControl);
  if (formControl) {
    lines.push("  ui: {");
    lines.push(`    formControl: ${JSON.stringify(formControl)} // or "select"`);
    lines.push("  }");
  } else {
    const lastIndex = lines.length - 1;
    lines[lastIndex] = lines[lastIndex].replace(/,$/, "");
  }

  lines.push("});");
  return lines.join("\n");
}

function applyCrudResourceFieldPatch(
  source = "",
  {
    fieldKey = "",
    outputSchemaExpression = "",
    createSchemaExpression = "",
    outputNormalizationExpression = "",
    inputNormalizationExpression = "",
    fieldMetaEntry = null,
    normalizeImportNames = [],
    databaseRuntimeImportNames = [],
    databaseRuntimeRepositoryOptionsImportNames = [],
    context = "crud-server-generator scaffold-field"
  } = {}
) {
  const normalizedFieldKey = normalizeText(fieldKey);
  if (!normalizedFieldKey) {
    throw new Error(`${context} apply patch requires fieldKey.`);
  }
  if (!normalizeText(outputSchemaExpression)) {
    throw new Error(`${context} apply patch requires outputSchemaExpression.`);
  }
  if (!normalizeText(createSchemaExpression)) {
    throw new Error(`${context} apply patch requires createSchemaExpression.`);
  }
  if (!normalizeText(outputNormalizationExpression)) {
    throw new Error(`${context} apply patch requires outputNormalizationExpression.`);
  }
  if (!normalizeText(inputNormalizationExpression)) {
    throw new Error(`${context} apply patch requires inputNormalizationExpression.`);
  }

  const ast = parseModule(source, context);
  const programNode = ast.program;
  let changed = false;

  const recordOutputSchemaObject = requireSchemaPropertiesObject(programNode, "recordOutputSchema", context);
  changed =
    insertObjectProperty(recordOutputSchemaObject, normalizedFieldKey, outputSchemaExpression, {
      context,
      insertBeforeComputed: true
    }) || changed;

  const createBodySchemaObject = requireSchemaPropertiesObject(programNode, "createBodySchema", context);
  changed =
    insertObjectProperty(createBodySchemaObject, normalizedFieldKey, createSchemaExpression, {
      context
    }) || changed;

  const recordNormalizeFunctionBody = requireNormalizeFunctionBody(programNode, "recordOutputValidator", context);
  const recordNormalizedObject = requireNormalizedObjectLiteral(recordNormalizeFunctionBody, context);
  changed =
    insertObjectProperty(recordNormalizedObject, normalizedFieldKey, outputNormalizationExpression, {
      context
    }) || changed;

  const createNormalizeFunctionBody = requireNormalizeFunctionBody(programNode, "createBodyValidator", context);
  if (!hasNormalizeIfInSourceCall(createNormalizeFunctionBody, normalizedFieldKey)) {
    const insertionStatement = parseStatement(
      `normalizeIfInSource(source, normalized, ${JSON.stringify(normalizedFieldKey)}, ${inputNormalizationExpression});`,
      context
    );
    const insertionIndex = resolveReturnNormalizedIndex(createNormalizeFunctionBody);
    createNormalizeFunctionBody.body.splice(insertionIndex, 0, insertionStatement);
    changed = true;
  }

  const validFieldMetaEntry =
    fieldMetaEntry &&
    typeof fieldMetaEntry === "object" &&
    normalizeText(fieldMetaEntry.key) === normalizedFieldKey
      ? fieldMetaEntry
      : null;
  if (validFieldMetaEntry && !hasResourceFieldMetaEntry(programNode, normalizedFieldKey)) {
    const fieldMetaStatement = parseStatement(renderResourceFieldMetaPushStatement(validFieldMetaEntry), context);
    programNode.body.push(fieldMetaStatement);
    changed = true;
  }

  const normalizeImports = Array.isArray(normalizeImportNames) ? normalizeImportNames : [];
  for (const importName of normalizeImports) {
    changed =
      ensureNamedImport(programNode, "@jskit-ai/kernel/shared/support/normalize", importName) || changed;
  }

  const databaseRuntimeImports = Array.isArray(databaseRuntimeImportNames) ? databaseRuntimeImportNames : [];
  for (const importName of databaseRuntimeImports) {
    changed = ensureNamedImport(programNode, "@jskit-ai/database-runtime/shared", importName) || changed;
  }

  const databaseRuntimeRepositoryOptionsImports = Array.isArray(databaseRuntimeRepositoryOptionsImportNames)
    ? databaseRuntimeRepositoryOptionsImportNames
    : [];
  for (const importName of databaseRuntimeRepositoryOptionsImports) {
    changed =
      ensureNamedImport(
        programNode,
        "@jskit-ai/database-runtime/shared/repositoryOptions",
        importName
      ) || changed;
  }

  return {
    changed,
    content: changed ? recast.print(ast, { reuseWhitespace: true }).code : String(source || "")
  };
}

export {
  resolveCrudResourceDefaults,
  applyCrudResourceFieldPatch
};
