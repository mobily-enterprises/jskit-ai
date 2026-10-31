import { noDuplicateHelper } from "./rules/noDuplicateHelper.js";
import { noModuleRegistry } from "./rules/noModuleRegistry.js";
import { noSlotSetter } from "./rules/noSlotSetter.js";
import { oneLineAction } from "./rules/oneLineAction.js";
import { requiredCollaborators } from "./rules/requiredCollaborators.js";
import { typedDependencies } from "./rules/typedDependencies.js";

// The `jskit` ESLint plugin: the typed-features rules, by name.
const jskitPlugin = Object.freeze({
  meta: Object.freeze({ name: "@jskit-ai/config-eslint/jskit" }),
  rules: Object.freeze({
    "typed-dependencies": typedDependencies,
    "required-collaborators": requiredCollaborators,
    "no-slot-setter": noSlotSetter,
    "no-module-registry": noModuleRegistry,
    "one-line-action": oneLineAction,
    "no-duplicate-helper": noDuplicateHelper
  })
});

export { jskitPlugin };
