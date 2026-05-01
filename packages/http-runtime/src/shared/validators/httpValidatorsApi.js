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
  JSON_API_CONTENT_TYPE,
  createJsonApiDocument,
  createJsonApiErrorDocumentFromFailure,
  createJsonApiErrorObject,
  createJsonApiResourceObject,
  isJsonApiCollectionDocument,
  isJsonApiContentType,
  isJsonApiErrorDocument,
  isJsonApiResourceDocument,
  isJsonContentType,
  normalizeJsonApiDocument,
  normalizeJsonApiResourceObject,
  resolveJsonApiTransportTypes,
  simplifyJsonApiDocument
} from "./jsonApiTransport.js";
import {
  JSON_API_QUERY_PAGE_CURSOR_KEY,
  JSON_API_QUERY_PAGE_LIMIT_KEY,
  JSON_API_QUERY_INCLUDE_KEY,
  JSON_API_QUERY_SORT_KEY,
  mapPlainQueryKeyToTransportKey,
  mapTransportQueryKeyToPlainKey,
  encodeJsonApiResourceQueryObject,
  decodeJsonApiResourceQueryObject,
  createJsonApiResourceQueryTransportSchema
} from "./jsonApiQueryTransport.js";
import {
  JSON_API_ERROR_DOCUMENT_SCHEMA,
  createJsonApiResourceObjectTransportSchema,
  createJsonApiResourceRequestBodyTransportSchema,
  createJsonApiResourceSuccessTransportSchema,
  withJsonApiErrorResponses,
  createJsonApiResourceRouteTransport,
  createJsonApiResourceRouteContract
} from "./jsonApiRouteTransport.js";

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
  JSON_API_CONTENT_TYPE,
  createJsonApiDocument,
  createJsonApiErrorDocumentFromFailure,
  createJsonApiErrorObject,
  createJsonApiResourceObject,
  isJsonApiCollectionDocument,
  isJsonApiContentType,
  isJsonApiErrorDocument,
  isJsonApiResourceDocument,
  isJsonContentType,
  normalizeJsonApiDocument,
  normalizeJsonApiResourceObject,
  resolveJsonApiTransportTypes,
  simplifyJsonApiDocument,
  JSON_API_QUERY_PAGE_CURSOR_KEY,
  JSON_API_QUERY_PAGE_LIMIT_KEY,
  JSON_API_QUERY_INCLUDE_KEY,
  JSON_API_QUERY_SORT_KEY,
  mapPlainQueryKeyToTransportKey,
  mapTransportQueryKeyToPlainKey,
  encodeJsonApiResourceQueryObject,
  decodeJsonApiResourceQueryObject,
  createJsonApiResourceQueryTransportSchema,
  JSON_API_ERROR_DOCUMENT_SCHEMA,
  createJsonApiResourceObjectTransportSchema,
  createJsonApiResourceRequestBodyTransportSchema,
  createJsonApiResourceSuccessTransportSchema,
  withJsonApiErrorResponses,
  createJsonApiResourceRouteTransport,
  createJsonApiResourceRouteContract
});

export { HTTP_VALIDATORS_API };
