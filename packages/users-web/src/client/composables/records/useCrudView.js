import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  resolveLookupFieldDisplayValue,
  resolveRecordTitle
} from "../crud/crudLookupFieldLabelSupport.js";
import { resolveCrudBoundValues } from "../crud/crudBindingSupport.js";
import { asPlainObject } from "../support/scopeHelpers.js";
import { useView } from "./useView.js";

function useCrudView({
  paramBinding = null,
  route = null,
  ...viewOptions
} = {}) {
  const sourceRoute = route && typeof route === "object" ? route : useRoute();
  const boundRouteParams = computed(() => {
    return resolveCrudBoundValues({
      binding: paramBinding,
      routeValues: asPlainObject(sourceRoute?.params || {}),
      context: Object.freeze({
        route: sourceRoute
      })
    });
  });
  const view = useView({
    ...viewOptions,
    routeParams: boundRouteParams
  });
  view.resolveFieldDisplay = resolveLookupFieldDisplayValue;
  view.resolveRecordTitle = resolveRecordTitle;
  return view;
}

export { useCrudView };
