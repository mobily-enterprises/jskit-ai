import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  resolveCrudJsonApiTransport
} from "../crud/crudJsonApiTransportSupport.js";
import { resolveCrudHttpClient } from "../crud/crudHttpClientSupport.js";
import { resolveCrudBoundValues } from "../crud/crudBindingSupport.js";
import { asPlainObject } from "../support/scopeHelpers.js";
import { useView } from "./useView.js";

function useCrudView({
  resource = null,
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
    resource,
    client: resolveCrudHttpClient(resource, {
      client: viewOptions.client
    }),
    transport: resolveCrudJsonApiTransport(viewOptions.transport, resource, {
      mode: "view"
    }),
    routeParams: boundRouteParams
  });
  return view;
}

export { useCrudView };
