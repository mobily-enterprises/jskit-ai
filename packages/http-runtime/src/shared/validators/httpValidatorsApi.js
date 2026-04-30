import { createPaginationQuerySchema } from "./paginationQuery.js";
import {
  fieldErrorsFieldDefinition,
  apiErrorDetailsSchema,
  apiValidationErrorDetailsSchema,
  apiErrorOutputValidator,
  apiValidationErrorOutputValidator,
  apiErrorTransportSchema,
  apiValidationErrorTransportSchema,
  fastifyDefaultErrorTransportSchema,
  STANDARD_ERROR_STATUS_CODES,
  createTransportResponseSchema,
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
import {
  simplifyJsonApiDocument
} from "./jsonApiResponses.js";

const HTTP_VALIDATORS_API = Object.freeze({
  createPaginationQuerySchema,
  fieldErrorsFieldDefinition,
  apiErrorDetailsSchema,
  apiValidationErrorDetailsSchema,
  apiErrorOutputValidator,
  apiValidationErrorOutputValidator,
  apiErrorTransportSchema,
  apiValidationErrorTransportSchema,
  fastifyDefaultErrorTransportSchema,
  STANDARD_ERROR_STATUS_CODES,
  createTransportResponseSchema,
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
  validateOperationInput,
  simplifyJsonApiDocument
});

export { HTTP_VALIDATORS_API };
