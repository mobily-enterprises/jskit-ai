import { createReporter, ruleMeta } from "../support.js";

// Names that say only tests use an export: `__resetClock`, `setClockForTests`, `internalsForTesting`, `testOnlyStore`,
// `_testing`. `__testables` is the one place tests reach a module's pure helpers.
const TEST_ONLY_NAME = /^__(?!testables$)|(?:ForTests?|ForTesting|TestOnly)$|^testOnly|^_?testing$/u;

function exportedNames(node) {
  if (node.declaration?.type === "VariableDeclaration") {
    return node.declaration.declarations.filter((declarator) => declarator.id.type === "Identifier").map((declarator) => declarator.id);
  }
  if (node.declaration?.id) {
    return [node.declaration.id];
  }
  return node.specifiers.map((specifier) => specifier.exported);
}

// A module exports what other production modules import. Tests reach the rest through the feature, or through
// `__testables` for pure helpers; an export only tests use widens the module's API for them.
const noTestOnlyExport = Object.freeze({
  meta: ruleMeta("Disallow exports whose names say only tests use them.", {
    testOnlyExport: "{{name}} is exported for tests. Test through the feature, or reach a pure helper through __testables."
  }, "no-test-only-exports"),
  create(context) {
    const report = createReporter(context, "no-test-only-export");
    return {
      ExportNamedDeclaration(node) {
        for (const name of exportedNames(node)) {
          const text = name.type === "Literal" ? String(name.value) : name.name;
          if (TEST_ONLY_NAME.test(text)) {
            report(name, "test-only-export", "testOnlyExport", { name: text });
          }
        }
      }
    };
  }
});

export { noTestOnlyExport };
