import { actionExecuteShape } from "./rules/actionExecuteShape.js";
import { allowCommentForm } from "./rules/allowCommentForm.js";
import { frozenFactoryResult } from "./rules/frozenFactoryResult.js";
import { noOptionalAfterDefault } from "./rules/noOptionalAfterDefault.js";
import { jsdocDescriptionInside } from "./rules/jsdocDescriptionInside.js";
import { namedRepeatedType } from "./rules/namedRepeatedType.js";
import { noDualShape } from "./rules/noDualShape.js";
import { noDuplicateHelper } from "./rules/noDuplicateHelper.js";
import { noFactorySpread } from "./rules/noFactorySpread.js";
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
    "no-duplicate-helper": noDuplicateHelper,
    "allow-comment-form": allowCommentForm,
    "jsdoc-description-inside": jsdocDescriptionInside,
    "no-dual-shape": noDualShape,
    "named-repeated-type": namedRepeatedType,
    "action-execute-shape": actionExecuteShape,
    "no-factory-spread": noFactorySpread,
    "frozen-factory-result": frozenFactoryResult,
    "no-optional-after-default": noOptionalAfterDefault
  })
});

export { jskitPlugin };
