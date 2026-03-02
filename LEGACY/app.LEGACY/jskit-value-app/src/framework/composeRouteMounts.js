import {
  composeSurfaceRouteMountsFromContributions,
  resolveRouteMountPathByKey as resolveRouteMountPathByKeyCore,
  __testables as clientCompositionTestables
} from "@jskit-ai/web-runtime-core/clientComposition";
import { urlMountOverrides } from "../../config/urls.js";
import { listClientRouteMounts } from "./routeMountRegistry.js";

const RESERVED_ROUTE_MOUNT_PATHS = Object.freeze({
  app: Object.freeze(["/", "/choice-2"]),
  admin: Object.freeze(["/", "/settings", "/admin", "/billing", "/transcripts", "/choice-2"]),
  console: Object.freeze(["/"])
});

function composeSurfaceRouteMounts(surface, { enabledModuleIds, mountOverrides = urlMountOverrides } = {}) {
  return composeSurfaceRouteMountsFromContributions({
    routeMountContributions: listClientRouteMounts(),
    surface,
    enabledModuleIds,
    mountOverrides,
    reservedPathsBySurface: RESERVED_ROUTE_MOUNT_PATHS
  });
}

function resolveRouteMountPathByKey(surface, mountKey, options = {}) {
  return resolveRouteMountPathByKeyCore({
    surface,
    mountKey,
    composeRouteMounts: (surfaceValue) => composeSurfaceRouteMounts(surfaceValue, options),
    fallbackPath: options?.fallbackPath,
    required: options?.required !== false
  });
}

const __testables = {
  normalizePath: clientCompositionTestables.normalizePath
};

export {
  composeSurfaceRouteMounts,
  resolveRouteMountPathByKey,
  __testables
};
