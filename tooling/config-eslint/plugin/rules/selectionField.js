import { CLIENT_GUIDE_URL, compactText, createReporter, deepFreezeNames, isFreezeCall, ruleMeta } from "../support.js";
import { vueImportNames } from "../vueSources.js";

// The Vuetify selection components and JSKIT's SelectField, by the kebab-case name a template writes or that its
// PascalCase name (VSelect, SelectField) stands for.
const VUETIFY_SELECTIONS = new Set(["v-select", "v-autocomplete", "v-combobox"]);
const SELECT_FIELD = "select-field";
// A module under a `shared` folder or subpath (`../shared/statusOptions.js`, `@local/books/shared`): one place for a
// fixed list both sides read.
const SHARED_MODULE = /(?:^|\/)shared(?:\/|$)/u;
const COMPUTED = new Set(["computed"]);

const kebabName = (rawName) => rawName.replace(/(?<!^)([A-Z])/gu, "-$1").toLowerCase();

// A list written out: an array literal with no spread of another list into it.
const isWrittenList = (node) => node?.type === "ArrayExpression" && node.elements.every((element) => element?.type !== "SpreadElement");

// A value written out where it is declared: a list, an object with no spread, or a primitive literal.
function isWrittenValue(node) {
  if (node?.type === "ObjectExpression") return node.properties.every((property) => property.type === "Property");
  return isWrittenList(node) || node?.type === "Literal" || (node?.type === "TemplateLiteral" && node.expressions.length === 0);
}

// The value a computed() returns when its getter only returns one expression: `() => [...]` or `() => { return [...]; }`.
function computedResult(getter) {
  if (getter?.type !== "ArrowFunctionExpression" && getter?.type !== "FunctionExpression") return null;
  if (getter.body.type !== "BlockStatement") return getter.body;
  const [statement] = getter.body.body;
  return getter.body.body.length === 1 && statement.type === "ReturnStatement" ? statement.argument : null;
}

// Whether a top-level const holds a fixed value: written out, frozen as written (Object.freeze, the kernel's
// deepFreeze), or Vue's computed() over a list written out, as a translated list of fixed options is.
function isFixedValue(node, { freezing, computing }) {
  if (isFreezeCall(node)) return isWrittenValue(node.arguments[0]);
  if (node?.type !== "CallExpression" || node.callee.type !== "Identifier") return isWrittenValue(node);
  if (computing.has(node.callee.name)) return isWrittenList(computedResult(node.arguments[0]));
  return freezing.has(node.callee.name) && isWrittenValue(node.arguments[0]);
}

// The names a component's scripts bind to fixed options: top-level consts holding a fixed value, and every import from a
// shared module.
function fixedBindings(program) {
  const names = new Set();
  const context = { freezing: deepFreezeNames(program), computing: vueImportNames(program, COMPUTED) };
  for (const statement of program.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type === "ImportDeclaration" && SHARED_MODULE.test(String(declaration.source.value))) {
      for (const specifier of declaration.specifiers) names.add(specifier.local.name);
    }
    if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") continue;
    for (const declarator of declaration.declarations) {
      if (declarator.id.type === "Identifier" && isFixedValue(declarator.init, context)) names.add(declarator.id.name);
    }
  }
  return names;
}

// The attribute that gives an element a prop, static (`items="..."`) or bound (`:items`, `v-bind:items`).
function propAttribute(element, name) {
  return element.startTag.attributes.find((attribute) => attribute.directive
    ? attribute.key.name.name === "bind" && attribute.key.argument?.type === "VIdentifier" && attribute.key.argument.name === name
    : attribute.key.name === name);
}

// Whether an element binds an object of props (`v-bind="fieldProps"`), which may hold any of them.
const bindsObject = (element) => element.startTag.attributes.some((attribute) => attribute.directive &&
  attribute.key.name.name === "bind" && !attribute.key.argument);

// The identifier a binding reads its value through: `OPTIONS` or `OPTIONS.status.list`, never a computed member.
function rootIdentifier(expression) {
  let node = expression;
  while (node?.type === "MemberExpression" && !node.computed) node = node.object;
  return node?.type === "Identifier" ? node : null;
}

// Whether an element's items are fixed: a list written out in the template, or read through a script binding to fixed
// options that no v-for or slot variable of the template shadows. A static items attribute names no loaded data.
function hasFixedItems(attribute, bindings) {
  if (!attribute.directive) return true;
  const container = attribute.value;
  if (isWrittenList(container?.expression)) return true;
  const root = rootIdentifier(container?.expression);
  const templateVariable = container?.references.some((reference) => reference.id === root && reference.variable);
  return Boolean(root) && !templateVariable && bindings.has(root.name);
}

// A select, autocomplete or combobox whose options load from the server, or whose value is a record id, is JSKIT's
// SelectField with `loading`, which never shows a stored id as text while the options load. Nothing in a template
// tells which ones load, so a raw Vuetify selection is reported unless its items are fixed: a list written out, a
// top-level const holding one (as written, frozen, or computed() over one) or an import from a shared module. One with
// no items at all, such as a combobox that takes typed entries, has nothing to load. A SelectField whose items are not
// fixed binds `loading` (or a v-bind object that may hold it).
const selectionField = Object.freeze({
  meta: ruleMeta("Require a select, autocomplete or combobox whose options are not fixed to be SelectField with loading.", {
    rawSelection: "<{{tag}}> takes its options from {{items}}, not a fixed list (one written out, a top-level const holding one, or an import from a shared module). Options that load from the server, or a value that is a record id, take SelectField from @jskit-ai/http-web/client/components/SelectField with loading, so a stored id never shows as text.",
    selectFieldLoading: "SelectField takes its options from {{items}} but binds no loading. Bind :loading while they load, so a stored id never shows as text."
  }, "selection-fields", CLIENT_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    if (!sourceCode.ast.templateBody) {
      return {};
    }
    const report = createReporter(context, "selection-field");
    const bindings = fixedBindings(sourceCode.ast);
    return sourceCode.parserServices.defineTemplateBodyVisitor({
      VElement(element) {
        const tag = kebabName(element.rawName);
        if (!VUETIFY_SELECTIONS.has(tag) && tag !== SELECT_FIELD) return;
        const items = propAttribute(element, "items");
        if (items ? hasFixedItems(items, bindings) : !bindsObject(element)) return;
        const source = items?.value?.expression ? compactText(sourceCode, items.value.expression) : "a v-bind object";
        if (tag !== SELECT_FIELD) {
          report(element.startTag, "selection-field", "rawSelection", { tag: element.rawName, items: source });
        } else if (!propAttribute(element, "loading") && !bindsObject(element)) {
          report(element.startTag, "selection-field", "selectFieldLoading", { items: source });
        }
      }
    });
  }
});

export { selectionField };
