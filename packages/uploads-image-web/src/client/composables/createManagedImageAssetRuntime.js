import { computed, ref, unref } from "vue";
import { createImageUploadRuntime } from "./createImageUploadRuntime.js";

const DEFAULT_MANAGED_IMAGE_ASSET_MESSAGES = Object.freeze({
  endpointUnavailable: "Image endpoint is unavailable.",
  uploadSuccess: "Image uploaded.",
  uploadInvalidResponse: "Image uploaded, but the response payload was invalid.",
  uploadError: "Unable to upload image.",
  uploadRestriction: "Selected image does not meet upload restrictions.",
  editorUnavailable: "Image editor is unavailable in this environment.",
  deleteSuccess: "Image removed.",
  deleteError: "Unable to remove image.",
  deleteUnavailable: "Image removal is unavailable.",
  changeError: "Image updated, but the page could not refresh."
});

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeWritableRef(value, fallbackValue = "") {
  if (value && typeof value === "object" && "value" in value) {
    return value;
  }

  return ref(normalizeText(fallbackValue));
}

function closeDashboard(uppy) {
  const dashboard = uppy?.getPlugin?.("Dashboard");
  if (!dashboard || typeof dashboard.closeModal !== "function") {
    return;
  }

  dashboard.closeModal();
}

async function readJsonResponse(response) {
  const contentType = normalizeText(response?.headers?.get?.("content-type")).toLowerCase();
  if (!contentType.includes("application/json")) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function resolveMessage(value, fallback) {
  const normalizedValue = normalizeText(value);
  return normalizedValue || fallback;
}

function resolveUploadErrorFallback({ error, response, fallbackMessage }) {
  const body = response?.body && typeof response.body === "object" ? response.body : {};
  return resolveMessage(body?.error || error?.message, fallbackMessage);
}

function resolveDeleteErrorFallback({ error, body, fallbackMessage }) {
  const normalizedBody = body && typeof body === "object" ? body : {};
  return resolveMessage(normalizedBody?.error || error?.message, fallbackMessage);
}

function normalizeDeleteResult(result) {
  if (result && typeof result === "object" && ("body" in result || "response" in result)) {
    return {
      body: result.body ?? null,
      response: result.response ?? null
    };
  }

  return {
    body: result ?? null,
    response: null
  };
}

function createManagedImageAssetRuntime({
  uploadEndpoint = "",
  deleteEndpoint = "",
  fieldName = "file",
  hasAsset = false,
  assetVersion = "",
  selectedFileName = null,
  resolveAssetUrl = null,
  resolveRequestHeaders = null,
  onUploadSuccess = null,
  onDeleteSuccess = null,
  resolveUploadErrorMessage = null,
  resolveDeleteErrorMessage = null,
  deleteRequest = null,
  reportFeedback = null,
  messages = {},
  uploadOptions = {},
  deleteMethod = "DELETE",
  source = "uploads-image-web.managed-image-asset",
  dependencies = {}
} = {}) {
  const createImageUploadRuntimeFactory = dependencies.createImageUploadRuntimeFactory || createImageUploadRuntime;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch?.bind(globalThis);
  const normalizedMessages = {
    ...DEFAULT_MANAGED_IMAGE_ASSET_MESSAGES,
    ...normalizeObject(messages)
  };
  const selectedFileNameRef = normalizeWritableRef(selectedFileName);
  const isDeleting = ref(false);
  const normalizedFieldName = normalizeText(fieldName || "file") || "file";
  const normalizedDeleteMethod = normalizeText(deleteMethod || "DELETE").toUpperCase() || "DELETE";
  const normalizedUploadOptions = normalizeObject(uploadOptions);

  const normalizedUploadEndpoint = computed(() => normalizeText(unref(uploadEndpoint)));
  const normalizedDeleteEndpoint = computed(() => {
    const explicitDeleteEndpoint = normalizeText(unref(deleteEndpoint));
    return explicitDeleteEndpoint || normalizedUploadEndpoint.value;
  });
  const normalizedHasAsset = computed(() => Boolean(unref(hasAsset)));
  const normalizedAssetVersion = computed(() => normalizeText(unref(assetVersion)));
  const assetUrl = computed(() => {
    if (!normalizedHasAsset.value) {
      return "";
    }

    if (typeof resolveAssetUrl !== "function") {
      return normalizedUploadEndpoint.value;
    }

    return normalizeText(
      resolveAssetUrl({
        uploadEndpoint: normalizedUploadEndpoint.value,
        deleteEndpoint: normalizedDeleteEndpoint.value,
        hasAsset: normalizedHasAsset.value,
        assetVersion: normalizedAssetVersion.value,
        fieldName: normalizedFieldName
      })
    );
  });

  let imageUploadRuntime = null;
  let runtimeUploadEndpoint = "";

  function report({
    message = "",
    severity = "success",
    channel = "snackbar",
    dedupeKey = ""
  } = {}) {
    const normalizedMessage = normalizeText(message);
    if (!normalizedMessage || typeof reportFeedback !== "function") {
      return;
    }

    reportFeedback({
      message: normalizedMessage,
      severity,
      channel,
      dedupeKey: normalizeText(dedupeKey) || `${source}:${severity}:${normalizedMessage}`
    });
  }

  async function resolveHeaders(action, endpoint) {
    if (typeof resolveRequestHeaders !== "function") {
      return {};
    }

    return normalizeObject(
      await resolveRequestHeaders({
        action,
        uploadEndpoint: normalizedUploadEndpoint.value,
        deleteEndpoint: normalizedDeleteEndpoint.value,
        endpoint: normalizeText(endpoint),
        fieldName: normalizedFieldName
      })
    );
  }

  function updateSelectedFileName(fileName = "") {
    selectedFileNameRef.value = normalizeText(fileName);
  }

  async function runChangeHandler(handler, payload) {
    if (typeof handler !== "function") {
      return;
    }

    try {
      await Promise.resolve(handler(payload));
    } catch (error) {
      report({
        message: resolveMessage(error?.message, normalizedMessages.changeError),
        severity: "error",
        channel: "banner",
        dedupeKey: `${source}:change-error`
      });
    }
  }

  function resolveCustomUploadErrorMessage(error, response) {
    const fallbackMessage = resolveUploadErrorFallback({
      error,
      response,
      fallbackMessage: normalizedMessages.uploadError
    });
    if (typeof resolveUploadErrorMessage !== "function") {
      return fallbackMessage;
    }

    return resolveMessage(
      resolveUploadErrorMessage({
        error,
        response,
        fieldName: normalizedFieldName,
        defaultMessage: fallbackMessage
      }),
      fallbackMessage
    );
  }

  function resolveCustomDeleteErrorMessage(error, response, body) {
    const fallbackMessage = resolveDeleteErrorFallback({
      error,
      body,
      fallbackMessage: normalizedMessages.deleteError
    });
    if (typeof resolveDeleteErrorMessage !== "function") {
      return fallbackMessage;
    }

    return resolveMessage(
      resolveDeleteErrorMessage({
        error,
        response,
        body,
        fieldName: normalizedFieldName,
        defaultMessage: fallbackMessage
      }),
      fallbackMessage
    );
  }

  function destroy() {
    if (!imageUploadRuntime) {
      return;
    }

    imageUploadRuntime.destroy();
    imageUploadRuntime = null;
    runtimeUploadEndpoint = "";
  }

  function ensureUploadRuntime() {
    const endpoint = normalizedUploadEndpoint.value;
    if (!endpoint) {
      destroy();
      return null;
    }

    if (imageUploadRuntime && runtimeUploadEndpoint === endpoint) {
      return imageUploadRuntime;
    }

    destroy();

    imageUploadRuntime = createImageUploadRuntimeFactory({
      ...normalizedUploadOptions,
      endpoint,
      fieldName: normalizedFieldName,
      resolveRequestHeaders: async () => resolveHeaders("upload", endpoint),
      onSelectedFileNameChanged: updateSelectedFileName,
      onUploadSuccess: async (payload) => {
        closeDashboard(payload?.uppy);
        updateSelectedFileName("");
        report({
          message: normalizedMessages.uploadSuccess,
          severity: "success",
          channel: "snackbar",
          dedupeKey: `${source}:upload-success`
        });
        await runChangeHandler(onUploadSuccess, payload);
      },
      onInvalidResponse: () => {
        report({
          message: normalizedMessages.uploadInvalidResponse,
          severity: "error",
          channel: "banner",
          dedupeKey: `${source}:upload-invalid-response`
        });
      },
      onUploadError: ({ error, response }) => {
        report({
          message: resolveCustomUploadErrorMessage(error, response),
          severity: "error",
          channel: "banner",
          dedupeKey: `${source}:upload-error`
        });
      },
      onRestrictionFailed: ({ error }) => {
        report({
          message: resolveMessage(error?.message, normalizedMessages.uploadRestriction),
          severity: "error",
          channel: "banner",
          dedupeKey: `${source}:upload-restriction`
        });
      },
      onUnavailable: () => {
        report({
          message: normalizedMessages.editorUnavailable,
          severity: "error",
          channel: "banner",
          dedupeKey: `${source}:editor-unavailable`
        });
      }
    });
    runtimeUploadEndpoint = endpoint;

    return imageUploadRuntime;
  }

  function setup() {
    const runtime = ensureUploadRuntime();
    runtime?.setup?.();
  }

  function openEditor() {
    const runtime = ensureUploadRuntime();
    if (!runtime) {
      report({
        message: normalizedMessages.endpointUnavailable,
        severity: "error",
        channel: "banner",
        dedupeKey: `${source}:endpoint-unavailable`
      });
      return;
    }

    runtime.openEditor();
  }

  async function deleteAsset() {
    if (isDeleting.value) {
      return;
    }

    const endpoint = normalizedDeleteEndpoint.value;
    if (!endpoint) {
      report({
        message: normalizedMessages.deleteUnavailable,
        severity: "error",
        channel: "banner",
        dedupeKey: `${source}:delete-unavailable`
      });
      return;
    }

    if (typeof deleteRequest !== "function" && typeof fetchImpl !== "function") {
      report({
        message: normalizedMessages.deleteUnavailable,
        severity: "error",
        channel: "banner",
        dedupeKey: `${source}:delete-unavailable`
      });
      return;
    }

    let response = null;
    let body = null;

    isDeleting.value = true;
    try {
      const headers = await resolveHeaders("delete", endpoint);

      if (typeof deleteRequest === "function") {
        const deleteResult = normalizeDeleteResult(
          await deleteRequest({
            endpoint,
            method: normalizedDeleteMethod,
            headers,
            fetch: fetchImpl,
            uploadEndpoint: normalizedUploadEndpoint.value,
            deleteEndpoint: endpoint,
            fieldName: normalizedFieldName
          })
        );
        response = deleteResult.response;
        body = deleteResult.body;
        if (response && response.ok === false) {
          const requestError = new Error("Image delete request failed.");
          requestError.response = response;
          requestError.body = body;
          throw requestError;
        }
      } else {
        response = await fetchImpl(endpoint, {
          method: normalizedDeleteMethod,
          credentials: "include",
          headers
        });
        body = await readJsonResponse(response);

        if (!response.ok) {
          throw new Error("Image delete request failed.");
        }
      }

      updateSelectedFileName("");
      report({
        message: normalizedMessages.deleteSuccess,
        severity: "success",
        channel: "snackbar",
        dedupeKey: `${source}:delete-success`
      });
      await runChangeHandler(onDeleteSuccess, {
        data: body,
        response
      });
    } catch (error) {
      const errorResponse = response || error?.response || null;
      const errorBody = body ?? error?.body ?? null;

      report({
        message: resolveCustomDeleteErrorMessage(error, errorResponse, errorBody),
        severity: "error",
        channel: "banner",
        dedupeKey: `${source}:delete-error`
      });
    } finally {
      isDeleting.value = false;
    }
  }

  return Object.freeze({
    assetUrl,
    deleteAsset,
    destroy,
    hasAsset: normalizedHasAsset,
    isDeleting,
    openEditor,
    selectedFileName: selectedFileNameRef,
    setup
  });
}

export {
  createManagedImageAssetRuntime,
  DEFAULT_MANAGED_IMAGE_ASSET_MESSAGES
};
