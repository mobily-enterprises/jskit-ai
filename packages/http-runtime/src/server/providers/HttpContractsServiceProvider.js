import { createPaginationQuerySchema } from "../../shared/contracts/paginationQuery.js";
import { registerTypeBoxFormats, __testables } from "../../shared/contracts/typeboxFormats.js";
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
} from "../../shared/contracts/errorResponses.js";
import {
  createCursorPagedListResponseSchema,
  createResourceSchemaContract
} from "../../shared/contracts/resourceSchemaContract.js";
import { createCommandContract } from "../../shared/contracts/commandSchemaContract.js";
import {
  resolveSchemaMessages,
  resolveFieldSchema,
  resolveIssueField,
  resolveMissingRequiredFields,
  resolveIssueMessageFromSchema,
  mapOperationIssues
} from "../../shared/contracts/operationMessages.js";
import {
  validateOperationSection,
  validateOperationInput
} from "../../shared/contracts/operationValidation.js";

const HTTP_CONTRACTS_API = Object.freeze({
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
  createResourceSchemaContract,
  createCommandContract,
  resolveSchemaMessages,
  resolveFieldSchema,
  resolveIssueField,
  resolveMissingRequiredFields,
  resolveIssueMessageFromSchema,
  mapOperationIssues,
  validateOperationSection,
  validateOperationInput
});

class HttpContractsServiceProvider {
  static id = "contracts.http";

  register(app) {
    if (!app || typeof app.singleton !== "function") {
      throw new Error("HttpContractsServiceProvider requires application singleton().");
    }

    app.singleton("contracts.http", () => HTTP_CONTRACTS_API);
  }

  boot() {}
}

export { HttpContractsServiceProvider };
