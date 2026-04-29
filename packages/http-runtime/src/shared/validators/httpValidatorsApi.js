import { createPaginationQuerySchema } from "./paginationQuery.js";
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
} from "./errorResponses.js";
import {
  createCursorPagedListResponseSchema,
  createResource
} from "./resource.js";
import { createCommand } from "./command.js";
import {
  resolveSchemaMessages,
  resolveFieldSchema,
  resolveIssueField,
  resolveMissingRequiredFields,
  resolveIssueMessageFromSchema,
  mapOperationIssues
} from "./operationMessages.js";
import {
  validateOperationSection,
  validateOperationSectionAsync,
  validateOperationInput,
  validateOperationInputAsync
} from "./operationValidation.js";
import {
  simplifyJsonApiDocument
} from "./jsonApiResponses.js";

const HTTP_VALIDATORS_API = Object.freeze({
  createPaginationQuerySchema,
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
  validateOperationSectionAsync,
  validateOperationInput,
  validateOperationInputAsync,
  simplifyJsonApiDocument
});

export { HTTP_VALIDATORS_API };
