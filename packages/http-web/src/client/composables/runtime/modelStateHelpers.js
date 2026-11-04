import { watch } from "vue";

function isObjectLike(value) {
  return value !== null && typeof value === "object";
}

function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function captureModelSnapshot(model) {
  if (!isObjectLike(model)) {
    return null;
  }

  return deepClone(model);
}

function restoreModelSnapshot(model, snapshot) {
  if (!isObjectLike(model) || !isObjectLike(snapshot)) {
    return;
  }

  if (Array.isArray(model) && Array.isArray(snapshot)) {
    model.splice(0, model.length, ...snapshot);
    return;
  }

  if (Array.isArray(model) || Array.isArray(snapshot)) {
    return;
  }

  for (const key of Object.keys(model)) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, key)) {
      delete model[key];
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    model[key] = value;
  }
}

function ignoreLoadedPayload() {}

/**
 * @param {{
 *   resource: Pick<import("../../types.js").EndpointResource, "query" | "data">,
 *   model?: object,
 *   mapLoadedToModel?: import("../../types.js").MapLoadedToModel,
 *   resolveMapContext: () => object
 * }} options
 */
function watchResourceModelState({
  resource,
  model,
  mapLoadedToModel = ignoreLoadedPayload,
  resolveMapContext
}) {
  const modelSnapshot = captureModelSnapshot(model);

  watch(
    () => resource.query.isPending.value,
    (isPending) => {
      if (!isPending || !modelSnapshot) {
        return;
      }

      restoreModelSnapshot(model, modelSnapshot);
    },
    {
      immediate: true
    }
  );

  watch(
    () => resource.data.value,
    (payload) => {
      if (!payload) {
        return;
      }

      mapLoadedToModel(model, payload, resolveMapContext());
    },
    {
      immediate: true
    }
  );
}

export {
  ignoreLoadedPayload,
  captureModelSnapshot,
  restoreModelSnapshot,
  watchResourceModelState
};
