import { computed, proxyRefs } from "vue";
import { useRoute } from "vue-router";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  resolveRouteParamsSource,
  toRouteParamValue
} from "./support/routeTemplateHelpers.js";
import { useView } from "./records/useView.js";
import {
  resolveCrudListParentDescriptor,
  resolveCrudListParentRecordTitle,
  resolveCrudListParentTitleFromItems
} from "./internal/crudListParentTitleSupport.js";

function normalizeQueryKeyPrefix(value = []) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeText(entry))
      .filter(Boolean);
  }

  const normalizedValue = normalizeText(value);
  return normalizedValue ? [normalizedValue] : [];
}

function useCrudListParentTitle({
  listRuntime = null,
  resource = {},
  adapter = null,
  recordIdParam = "recordId",
  queryKeyPrefix = ["users-web", "crud-list-parent-title"],
  placementSource = "users-web.crud-list-parent-title",
  fallbackLoadError = "Unable to load parent record.",
  notFoundMessage = "Parent record not found.",
  route = null,
  viewRuntimeFactory = useView
} = {}) {
  const sourceRoute = route && typeof route === "object" ? route : useRoute();
  const parentDescriptor = computed(() => {
    const descriptor = resolveCrudListParentDescriptor({
      resource,
      route: sourceRoute,
      recordIdParam
    });
    if (!descriptor) {
      return null;
    }

    const routeParams = resolveRouteParamsSource(sourceRoute?.params || {});
    const routeParamValue = toRouteParamValue(routeParams[descriptor.routeParamKey]);
    if (!routeParamValue) {
      return null;
    }

    return Object.freeze({
      ...descriptor,
      routeParamValue
    });
  });

  const initialParentDescriptor = parentDescriptor.value || {};
  const normalizedQueryKeyPrefix = normalizeQueryKeyPrefix(queryKeyPrefix);
  const shouldLoadParentRecord = computed(() => {
    const descriptor = parentDescriptor.value;
    if (!descriptor?.apiUrlTemplate) {
      return false;
    }
    if (Boolean(listRuntime?.isInitialLoading) || normalizeText(listRuntime?.loadError)) {
      return false;
    }

    const items = Array.isArray(listRuntime?.items) ? listRuntime.items : [];
    return items.length < 1;
  });

  const parentView = viewRuntimeFactory({
    adapter,
    apiUrlTemplate: normalizeText(initialParentDescriptor.apiUrlTemplate),
    readEnabled: shouldLoadParentRecord,
    recordIdParam: normalizeText(initialParentDescriptor.routeParamKey) || "recordId",
    includeRecordIdInQueryKey: true,
    queryKeyFactory: (surfaceId = "", scopeParamValue = "") => [
      ...normalizedQueryKeyPrefix,
      normalizeText(initialParentDescriptor.relationNamespace),
      normalizeText(initialParentDescriptor.routeParamKey),
      String(surfaceId || ""),
      String(scopeParamValue || "")
    ],
    placementSource,
    fallbackLoadError,
    notFoundMessage
  });

  const title = computed(() => {
    const descriptor = parentDescriptor.value;
    if (!descriptor) {
      return "";
    }

    const parentRecordTitle = resolveCrudListParentRecordTitle(parentView?.record || {}, descriptor);
    if (parentRecordTitle && shouldLoadParentRecord.value) {
      return parentRecordTitle;
    }

    const listTitle = resolveCrudListParentTitleFromItems(listRuntime?.items, descriptor);
    if (listTitle) {
      return listTitle;
    }

    if (parentRecordTitle) {
      return parentRecordTitle;
    }

    if (descriptor.routeParamValue) {
      return `${descriptor.entityLabel} #${descriptor.routeParamValue}`;
    }

    return descriptor.entityLabel;
  });

  return proxyRefs({
    title,
    descriptor: parentDescriptor,
    shouldLoadParentRecord,
    record: computed(() => parentView?.record || null),
    isLoading: computed(() => Boolean(parentView?.isLoading)),
    loadError: computed(() => normalizeText(parentView?.loadError))
  });
}

export { useCrudListParentTitle };
