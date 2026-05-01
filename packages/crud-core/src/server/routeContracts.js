import { createJsonApiResourceRouteContract } from "@jskit-ai/http-runtime/shared/validators/jsonApiRouteTransport";
import {
  composeSchemaDefinitions,
  recordIdParamsValidator
} from "@jskit-ai/kernel/shared/validators";
import {
  createCrudCursorPaginationQueryValidator,
  listSearchQueryValidator as defaultListSearchQueryValidator,
  lookupIncludeQueryValidator as defaultLookupIncludeQueryValidator,
  createCrudParentFilterQueryValidator
} from "./listQueryValidators.js";

function createCrudJsonApiRouteContracts({
  resource = {},
  routeParamsValidator = null,
  listSearchQueryValidator = defaultListSearchQueryValidator,
  lookupIncludeQueryValidator = defaultLookupIncludeQueryValidator
} = {}) {
  const listCursorPaginationQueryValidator = createCrudCursorPaginationQueryValidator({
    orderBy: resource?.defaultSort
  });
  const listParentFilterQueryValidator = createCrudParentFilterQueryValidator(resource);
  const listRouteQueryValidator = composeSchemaDefinitions([
    listCursorPaginationQueryValidator,
    listSearchQueryValidator,
    listParentFilterQueryValidator,
    lookupIncludeQueryValidator
  ]);
  const recordRouteParamsValidator = routeParamsValidator
    ? composeSchemaDefinitions([
        routeParamsValidator,
        recordIdParamsValidator
      ])
    : recordIdParamsValidator;
  const routeType = resource?.namespace;

  return Object.freeze({
    listRouteContract: createJsonApiResourceRouteContract({
      type: routeType,
      query: listRouteQueryValidator,
      output: resource?.operations?.view?.output,
      outputKind: "collection"
    }),
    viewRouteContract: createJsonApiResourceRouteContract({
      type: routeType,
      query: lookupIncludeQueryValidator,
      output: resource?.operations?.view?.output,
      outputKind: "record"
    }),
    createRouteContract: createJsonApiResourceRouteContract({
      type: routeType,
      body: resource?.operations?.create?.body,
      output: resource?.operations?.create?.output,
      outputKind: "record",
      successStatus: 201,
      includeValidation400: true
    }),
    updateRouteContract: createJsonApiResourceRouteContract({
      type: routeType,
      body: resource?.operations?.patch?.body,
      output: resource?.operations?.patch?.output,
      outputKind: "record",
      includeValidation400: true
    }),
    deleteRouteContract: createJsonApiResourceRouteContract({
      type: routeType,
      outputKind: "no-content",
      successStatus: 204
    }),
    recordRouteParamsValidator
  });
}

export { createCrudJsonApiRouteContracts };
