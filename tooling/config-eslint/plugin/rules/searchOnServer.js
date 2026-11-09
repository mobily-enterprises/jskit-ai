import { CLIENT_GUIDE_URL, compactText, createReporter, ruleMeta, unwrapChain, walk } from "../support.js";
import { vueImportNames } from "../vueSources.js";

// A list composable holds the page it loaded, never every row, so a search over its items misses every row past that
// page. Pickers and list searches send the typed text to the server as q, where the resource's searchSchema.q searches
// every row. This rule reports the two shapes that search the loaded page instead: a computed() that filters a list
// composable's items by a search ref, and an autocomplete over a list's items or a lookup's options that lets Vuetify
// filter them (no `no-filter`) or never sends what the person types (no `update:search` handler).

// JSKIT's list composables, imported from any module: each answers one page of a resource's records as `items`.
const LIST_COMPOSABLES = new Set(["useList", "useListCore", "useCrudList", "useCrudListScreen", "usePagedCollection"]);
// The JSKIT call that answers a lookup field's or a lookup filter's options.
const LOOKUP_ITEMS = "resolveLookupItems";
// A ref that holds typed search text: a name with one of these words (`search`, `searchText`, `queryTerm`, `keywords`),
// or `q`; not a word that merely contains one (`terminal`, `determinate`).
const SEARCH_WORDS = new Set(["search", "query", "term", "terms", "keyword", "keywords"]);
const isSearchName = (name) => name === "q" ||
  name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase().split(/[\s_$]+/u).some((word) => SEARCH_WORDS.has(word));
const COMPUTED = new Set(["computed"]);
const AUTOCOMPLETES = new Set(["v-autocomplete", "vautocomplete"]);

// The attribute of a template element, by name: a plain one (`no-filter`), or a directive's argument (`:items`,
// `@update:search`, `v-model:search`) with the directive's name.
function attribute(element, name, directive = "") {
  return element.startTag.attributes.find((entry) => {
    if (!entry.directive) {
      return !directive && (entry.key.name === name || entry.key.rawName === name);
    }
    return entry.key.name.name === directive && entry.key.argument?.type === "VIdentifier" &&
      (entry.key.argument.name === name || entry.key.argument.rawName === name);
  });
}

const searchOnServer = Object.freeze({
  meta: ruleMeta("Report searches that filter a list's loaded page in the browser instead of asking the server.", {
    computedFilter: "computed() filters {{items}} by {{search}}: a list composable holds only the page it loaded, so the search misses every row past it. Search on the server: turn on the list's search (search: { enabled: true }), which sends q, and give the resource searchSchema.q.",
    localAutocomplete: "This autocomplete lists {{items}} but {{missing}}: Vuetify then searches only the options already loaded, so a record past the first page is never offered. Add no-filter and send the typed text with @update:search (a lookup's setLookupSearch), and give the resource searchSchema.q."
  }, "search-on-the-server", CLIENT_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    const visitorKeys = sourceCode.visitorKeys;
    const report = createReporter(context, "search-on-server");
    let computedNames = new Set();
    let listCalls = new Set();
    // The names a list composable's result is held under (`const list = useList(...)`), and its items destructured
    // (`const { items } = useList(...)`).
    const lists = new Set();
    const itemNames = new Set();

    // Whether an expression is a list composable's items: `list.items`, `list.items.value`, or destructured `items`.
    function isListItems(node) {
      let value = unwrapChain(node);
      if (value?.type === "MemberExpression" && !value.computed && value.property.name === "value") {
        value = unwrapChain(value.object);
      }
      if (value?.type === "Identifier") {
        return itemNames.has(value.name);
      }
      return value?.type === "MemberExpression" && !value.computed && value.property.name === "items" &&
        value.object.type === "Identifier" && lists.has(value.object.name);
    }

    // The first search ref a function reads, as text, or "": `search.value`, `queryText.value`, `list.searchQuery`.
    function searchRead(fn) {
      let found = "";
      walk(fn.body, visitorKeys, (node) => {
        if (found || node.type !== "MemberExpression" || node.computed) {
          return;
        }
        const named = node.property.name === "value" && node.object.type === "Identifier" && isSearchName(node.object.name);
        if (named || node.property.name === "searchQuery") {
          found = compactText(sourceCode, node);
        }
      });
      return found;
    }

    // A computed() getter that filters a list's items, directly or through a const it holds them in, by a search ref.
    function checkComputed(fn) {
      const search = searchRead(fn);
      if (!search) {
        return;
      }
      const aliases = new Set();
      walk(fn.body, visitorKeys, (node) => {
        if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) {
          let holds = false;
          walk(node.init, visitorKeys, (inner) => {
            holds ||= isListItems(inner);
          });
          if (holds) {
            aliases.add(node.id.name);
          }
        }
      });
      walk(fn.body, visitorKeys, (node) => {
        const callee = node.type === "CallExpression" ? unwrapChain(node.callee) : null;
        if (callee?.type !== "MemberExpression" || callee.computed || callee.property.name !== "filter") {
          return;
        }
        const source = unwrapChain(callee.object);
        if (isListItems(source) || (source.type === "Identifier" && aliases.has(source.name))) {
          report(node, "search-on-server", "computedFilter", { items: compactText(sourceCode, source), search });
        }
      });
    }

    // What an autocomplete's `:items` lists, as text, when it is a list's items or a lookup's options; "" otherwise.
    function resourceItems(expression) {
      let found = "";
      walk(expression, visitorKeys, (node) => {
        if (found) {
          return;
        }
        const callee = node.type === "CallExpression" ? unwrapChain(node.callee) : null;
        const called = callee?.type === "Identifier" ? callee.name : callee?.type === "MemberExpression" ? callee.property.name : "";
        if (called === LOOKUP_ITEMS || isListItems(node)) {
          found = compactText(sourceCode, called === LOOKUP_ITEMS ? callee : node);
        }
      });
      return found;
    }

    function checkAutocomplete(element) {
      const name = element.rawName.toLowerCase();
      const searchable = name === "selectfield" || name === "select-field"
        ? attribute(element, "searchable") || attribute(element, "searchable", "bind")
        : null;
      if (!AUTOCOMPLETES.has(name) && !searchable) {
        return;
      }
      const items = attribute(element, "items", "bind");
      const listed = items?.value?.expression ? resourceItems(items.value.expression) : "";
      if (!listed) {
        return;
      }
      const noFilter = attribute(element, "no-filter") || attribute(element, "noFilter") || attribute(element, "no-filter", "bind") ||
        attribute(element, "noFilter", "bind");
      const sends = attribute(element, "update:search", "on") || attribute(element, "search", "model");
      const missing = [!noFilter && "has no no-filter", !sends && "sends no typed text (@update:search)"].filter(Boolean);
      if (missing.length) {
        report(items, "search-on-server", "localAutocomplete", { items: listed, missing: missing.join(" and ") });
      }
    }

    const scriptVisitor = {
      Program(program) {
        computedNames = vueImportNames(program, COMPUTED);
        listCalls = new Set(program.body
          .filter((statement) => statement.type === "ImportDeclaration")
          .flatMap((statement) => statement.specifiers)
          .filter((specifier) => specifier.type === "ImportSpecifier" && LIST_COMPOSABLES.has(specifier.imported.name || specifier.imported.value))
          .map((specifier) => specifier.local.name));
      },
      VariableDeclarator(node) {
        const call = node.init?.type === "CallExpression" ? node.init : null;
        if (!call || call.callee.type !== "Identifier" || !listCalls.has(call.callee.name)) {
          return;
        }
        if (node.id.type === "Identifier") {
          lists.add(node.id.name);
        } else if (node.id.type === "ObjectPattern") {
          for (const property of node.id.properties) {
            if (property.type === "Property" && !property.computed && property.key.name === "items" && property.value.type === "Identifier") {
              itemNames.add(property.value.name);
            }
          }
        }
      },
      "Program:exit"() {
        // computed() calls are checked once every list in the module is known, wherever it is declared.
        walk(sourceCode.ast, visitorKeys, (node) => {
          if (node.type !== "CallExpression" || node.callee.type !== "Identifier" || !computedNames.has(node.callee.name)) {
            return;
          }
          const getter = node.arguments[0];
          if (getter?.type === "ArrowFunctionExpression" || getter?.type === "FunctionExpression") {
            checkComputed(getter);
          }
        });
      }
    };
    if (!sourceCode.ast.templateBody) {
      return scriptVisitor;
    }
    return sourceCode.parserServices.defineTemplateBodyVisitor({ VElement: checkAutocomplete }, scriptVisitor);
  }
});

export { searchOnServer };
