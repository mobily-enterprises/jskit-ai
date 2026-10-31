import { createReporter, followsOptionalLink, ruleMeta, walk } from "../support.js";

const REGISTER_NAME = /^register[A-Z]\w*$/u;
const COLLECTION_WRITES = new Set(["add", "set", "push", "unshift"]);

function moduleBindings(program) {
  const names = new Set();
  for (const statement of program.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") {
      continue;
    }
    for (const declarator of declaration.declarations) {
      if (declarator.id.type === "Identifier") {
        names.add(declarator.id.name);
      }
    }
  }
  return names;
}

// Entries reach their owner through a capability, not through a module-level
// register<Name>() that writes a module-level binding.
const noModuleRegistry = Object.freeze({
  meta: ruleMeta("Disallow module-level register<Name>() functions that write module state.", {
    moduleRegistry: "{{name}}() writes module state. Supply its entries through a capability instead of a module-level registry."
  }),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-module-registry");
    let bindings = new Set();
    return {
      Program(program) {
        bindings = moduleBindings(program);
      },
      FunctionDeclaration(node) {
        const atModuleScope = node.parent.type === "Program" ||
          (node.parent.type === "ExportNamedDeclaration" && node.parent.parent.type === "Program");
        if (!atModuleScope || !REGISTER_NAME.test(node.id?.name || "")) {
          return;
        }
        let writesModuleState = false;
        walk(node.body, sourceCode.visitorKeys, (inner) => {
          if (inner.type === "AssignmentExpression" && inner.left.type === "Identifier" && bindings.has(inner.left.name)) {
            writesModuleState = true;
          }
          if (inner.type === "CallExpression" && !followsOptionalLink(inner) && inner.callee.type === "MemberExpression" &&
            inner.callee.object.type === "Identifier" && bindings.has(inner.callee.object.name) &&
            COLLECTION_WRITES.has(inner.callee.property.name)) {
            writesModuleState = true;
          }
        });
        if (writesModuleState) {
          report(node, "module-registry", "moduleRegistry", { name: node.id.name });
        }
      }
    };
  }
});

export { noModuleRegistry };
