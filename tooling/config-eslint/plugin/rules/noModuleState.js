import { isVueStateCall } from "../factoryResults.js";
import { CLIENT_GUIDE_URL, createReporter, ruleMeta } from "../support.js";
import { scriptSetupRanges } from "../vueSources.js";

// The module's own top-level variable declarations, exported ones included.
function moduleDeclarations(program) {
  return program.body
    .map((statement) => statement.type === "ExportNamedDeclaration" ? statement.declaration : statement)
    .filter((declaration) => declaration?.type === "VariableDeclaration");
}

// Client state lives in the composable or factory that owns it. Module scope is
// shared by every component instance and every application on the page, and
// survives unmounting, so a module-level `let`, or a module-level ref() or
// reactive(), is state nobody owns. State the page shares on purpose (one
// microphone) says so with `shared resource:`. The top level of <script setup>
// belongs to each instance, and a const memo cache is not reported.
const noModuleState = Object.freeze({
  meta: ruleMeta("Disallow module-level mutable state in client code: a module-level let, ref() or reactive().", {
    moduleBinding: "{{kind}} {{name}} is module state every instance on the page shares. Move it into the composable or factory that owns it.",
    moduleReactive: "{{name}} = {{call}}() is reactive state every instance on the page shares. Create it inside the composable that owns it."
  }, "module-state", CLIENT_GUIDE_URL),
  create(context) {
    const sourceCode = context.sourceCode;
    const report = createReporter(context, "no-module-state");
    return {
      Program(program) {
        const instanceRanges = scriptSetupRanges(sourceCode);
        const perInstance = (node) => instanceRanges.some(([start, end]) => node.range[0] >= start && node.range[1] <= end);
        for (const declaration of moduleDeclarations(program)) {
          if (perInstance(declaration)) {
            continue;
          }
          for (const declarator of declaration.declarations) {
            const name = declarator.id.type === "Identifier" ? declarator.id.name : sourceCode.getText(declarator.id);
            const statement = declaration.parent.type === "ExportNamedDeclaration" ? declaration.parent : declaration;
            const site = declaration.declarations.length === 1 ? statement : declarator;
            if (declaration.kind === "let" || declaration.kind === "var") {
              report(site, "module-state", "moduleBinding", { kind: declaration.kind, name });
            } else if (isVueStateCall(declarator.init)) {
              report(site, "module-state", "moduleReactive", { name, call: declarator.init.callee.name });
            }
          }
        }
      }
    };
  }
});

export { noModuleState };
