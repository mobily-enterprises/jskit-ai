import { computed, unref } from "vue";
import { useRoute } from "vue-router";
import { resolveCrudJsonApiTransport } from "../crud/crudJsonApiTransportSupport.js";
import { resolveLookupFieldDisplayValue } from "../crud/crudLookupFieldLabelSupport.js";
import { resolveCrudBoundValues } from "../crud/crudBindingSupport.js";
import { resolveCrudListParentDescriptor } from "../internal/crudListParentTitleSupport.js";
import {
  resolveRouteParamsSource,
  toRouteParamValue
} from "../support/routeTemplateHelpers.js";
import { asPlainObject } from "../support/scopeHelpers.js";
import { useList } from "./useList.js";

function resolveRequestQueryParamsInput(requestQueryParams, context = {}) {
  if (typeof requestQueryParams === "function") {
    return asPlainObject(requestQueryParams(context));
  }

  return asPlainObject(unref(requestQueryParams));
}

function resolveCrudParentRequestQueryParams({ resource = {}, route = null, recordIdParam = "recordId" } = {}) {
  const descriptor = resolveCrudListParentDescriptor({
    resource,
    route,
    recordIdParam
  });
  if (!descriptor?.fieldKey || !descriptor?.routeParamKey) {
    return {};
  }

  const routeParams = resolveRouteParamsSource(route?.params || {});
  const routeParamValue = toRouteParamValue(routeParams[descriptor.routeParamKey]);
  if (!routeParamValue) {
    return {};
  }

  return {
    [descriptor.fieldKey]: routeParamValue
  };
}

function useCrudList({
  resource = null,
  requestQueryParams = null,
  parentBinding = null,
  recordIdParam = "recordId",
  route = null,
  ...listOptions
} = {}) {
  const sourceRoute = route && typeof route === "object" ? route : useRoute();
  const boundParentRequestQueryParams = computed(() => {
    return resolveCrudBoundValues({
      binding: parentBinding,
      routeValues: resolveCrudParentRequestQueryParams({
        resource,
        route: sourceRoute,
        recordIdParam
      }),
      context: Object.freeze({
        route: sourceRoute,
        resource,
        recordIdParam
      })
    });
  });
  const records = useList({
    ...listOptions,
    transport: resolveCrudJsonApiTransport(listOptions.transport, resource, {
      mode: "list"
    }),
    recordIdParam,
    requestQueryParams(context = {}) {
      const baseRequestQueryParams = resolveRequestQueryParamsInput(requestQueryParams, context);

      return {
        ...baseRequestQueryParams,
        ...boundParentRequestQueryParams.value
      };
    }
  });

  records.resolveFieldDisplay = resolveLookupFieldDisplayValue;
  return records;
}

export { useCrudList };
