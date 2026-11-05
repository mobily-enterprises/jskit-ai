import { actionCreator } from "./rules/actionCreator.js";
import { actionExecuteShape } from "./rules/actionExecuteShape.js";
import { allowCommentForm } from "./rules/allowCommentForm.js";
import { appErrorCode } from "./rules/appErrorCode.js";
import { collaboratorProps } from "./rules/collaboratorProps.js";
import { fixedResultShape } from "./rules/fixedResultShape.js";
import { frozenFactoryResult } from "./rules/frozenFactoryResult.js";
import { noOptionalAfterDefault } from "./rules/noOptionalAfterDefault.js";
import { jsdocDescriptionInside } from "./rules/jsdocDescriptionInside.js";
import { namedRepeatedType } from "./rules/namedRepeatedType.js";
import { noDualShape } from "./rules/noDualShape.js";
import { noDuplicateHelper } from "./rules/noDuplicateHelper.js";
import { noEnvDefault } from "./rules/noEnvDefault.js";
import { noFactorySpread } from "./rules/noFactorySpread.js";
import { noFrozenVueState } from "./rules/noFrozenVueState.js";
import { noIdempotency } from "./rules/noIdempotency.js";
import { noModuleRegistry } from "./rules/noModuleRegistry.js";
import { noModuleState } from "./rules/noModuleState.js";
import { noPatchedError } from "./rules/noPatchedError.js";
import { noSlotSetter } from "./rules/noSlotSetter.js";
import { noTestOnlyExport } from "./rules/noTestOnlyExport.js";
import { oneLineAction } from "./rules/oneLineAction.js";
import { onePropertyPerLine } from "./rules/onePropertyPerLine.js";
import { playwrightLoginUnchanged } from "./rules/playwrightLoginUnchanged.js";
import { releasedListeners } from "./rules/releasedListeners.js";
import { requiredCollaborators } from "./rules/requiredCollaborators.js";
import { typedDependencies } from "./rules/typedDependencies.js";
import { typedInject } from "./rules/typedInject.js";

// The `jskit` ESLint plugin: the typed-features rules, by name, server and client, and the rule that keeps a Playwright
// config's managed login unchanged. Each rule's messages link to the guide section that explains it.
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
    "no-optional-after-default": noOptionalAfterDefault,
    "one-property-per-line": onePropertyPerLine,
    "action-creator": actionCreator,
    "no-idempotency": noIdempotency,
    "app-error-code": appErrorCode,
    "no-patched-error": noPatchedError,
    "no-env-default": noEnvDefault,
    "no-test-only-export": noTestOnlyExport,
    "typed-inject": typedInject,
    "collaborator-props": collaboratorProps,
    "fixed-result-shape": fixedResultShape,
    "released-listeners": releasedListeners,
    "no-module-state": noModuleState,
    "no-frozen-vue-state": noFrozenVueState,
    "playwright-login-unchanged": playwrightLoginUnchanged
  })
});

export { jskitPlugin };
