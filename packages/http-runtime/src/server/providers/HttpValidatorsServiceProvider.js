import { createPaginationQuerySchema } from "../../shared/validators/paginationQuery.js";
import { registerTypeBoxFormats, __testables } from "../../shared/validators/typeboxFormats.js";
import {
  fieldErrorsSchema,
  apiErrorDetailsSchema,
  apiErrorResponseSchema,
  apiValidationErrorResponseSchema,
  fastifyDefaultErrorResponseSchema,
  STANDARD_ERROR_STATUS_CODES,
  passthroughErrorResponses,
  withStandardErrorResponses,
  enumSchema
} from "../../shared/validators/errorResponses.js";
import {
  createCursorPagedListResponseSchema,
  createResource
} from "../../shared/validators/resource.js";
import { createCommand } from "../../shared/validators/command.js";
import {
  resolveSchemaMessages,
  resolveFieldSchema,
  resolveIssueField,
  resolveMissingRequiredFields,
  resolveIssueMessageFromSchema,
  mapOperationIssues
} from "../../shared/validators/operationMessages.js";
import {
  validateOperationSection,
  validateOperationInput
} from "../../shared/validators/operationValidation.js";

const HTTP_VALIDATORS_API = Object.freeze({
  createPaginationQuerySchema,
  registerTypeBoxFormats,
  __testables,
  fieldErrorsSchema,
  apiErrorDetailsSchema,
  apiErrorResponseSchema,
  apiValidationErrorResponseSchema,
  fastifyDefaultErrorResponseSchema,
  STANDARD_ERROR_STATUS_CODES,
  passthroughErrorResponses,
  withStandardErrorResponses,
  enumSchema,
  createCursorPagedListResponseSchema,
  createResource,
  createCommand,
  resolveSchemaMessages,
  resolveFieldSchema,
  resolveIssueField,
  resolveMissingRequiredFields,
  resolveIssueMessageFromSchema,
  mapOperationIssues,
  validateOperationSection,
  validateOperationInput
});

class HttpValidatorsServiceProvider {
  static id = "validators.http";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("HttpValidatorsServiceProvider requires application singleton().");
    }

    app.singleton("validators.http", () => HTTP_VALIDATORS_API);
  }

  boot() {}
}

export { HttpValidatorsServiceProvider };
