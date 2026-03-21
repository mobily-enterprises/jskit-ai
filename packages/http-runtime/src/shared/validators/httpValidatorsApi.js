import { createPaginationQuerySchema } from "./paginationQuery.js";
import { registerTypeBoxFormats, __testables } from "./typeboxFormats.js";
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
  validateOperationInput
} from "./operationValidation.js";

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

export { HTTP_VALIDATORS_API };
