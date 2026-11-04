import { computed, ref, unref } from "vue";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { createImageUploadRuntime } from "./createImageUploadRuntime.js";
import { closeDashboard } from "../support/uppyPlugins.js";
import { useJskitText } from "../i18n.js";

// Message keys; a caller's messages may be keys or plain text, rendered with
// useJskitText().text() when shown.
const DEFAULT_MANAGED_IMAGE_ASSET_MESSAGES = Object.freeze({
  endpointUnavailable: "jskit.uploads.imageAsset.endpointUnavailable",
  uploadSuccess: "jskit.uploads.imageAsset.uploadSuccess",
  uploadInvalidResponse: "jskit.uploads.imageAsset.uploadInvalidResponse",
  uploadError: "jskit.uploads.imageAsset.uploadError",
  uploadRestriction: "jskit.uploads.imageAsset.uploadRestriction",
  editorUnavailable: "jskit.uploads.imageAsset.editorUnavailable",
  deleteSuccess: "jskit.uploads.imageAsset.deleteSuccess",
  deleteError: "jskit.uploads.imageAsset.deleteError",
  deleteUnavailable: "jskit.uploads.imageAsset.deleteUnavailable",
  changeError: "jskit.uploads.imageAsset.changeError"
});

async function readJsonResponse(response) {
  const contentType = normalizeText(response.headers.get("content-type")).toLowerCase();
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

// The server's error in the user's language when JSKIT knows its code.
function resolveBodyErrorMessage(body) {
  const source = body && typeof body === "object" ? body : {};
  return source.error ? useJskitText().serverMessage({ ...source, message: source.error }) : "";
}

function resolveUploadErrorFallback({ error, response, fallbackMessage }) {
  return resolveMessage(resolveBodyErrorMessage(response?.body) || error?.message, fallbackMessage);
}

function resolveDeleteErrorFallback({ error, body, fallbackMessage }) {
  return resolveMessage(resolveBodyErrorMessage(body) || error?.message, fallbackMessage);
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

/** The delete an application gets unless it supplies its own. */
async function requestDeleteWithFetch({ endpoint, method, headers, fetch }) {
  const response = await fetch(endpoint, {
    method,
    credentials: "include",
    headers
  });

  return {
    body: await readJsonResponse(response),
    response
  };
}

function assetUrlFromUploadEndpoint({ uploadEndpoint }) {
  return uploadEndpoint;
}

function keepDefaultMessage({ defaultMessage }) {
  return defaultMessage;
}

function ignoreDeleteSuccess() {}

/** @param {import("../types.js").ManagedImageAssetRuntimeOptions} options */
function createManagedImageAssetRuntime({
  uploadEndpoint = "",
  deleteEndpoint = "",
  fieldName = "file",
  hasAsset = false,
  assetVersion = "",
  selectedFileName = ref(""),
  resolveAssetUrl = assetUrlFromUploadEndpoint,
  resolveRequestHeaders,
  onUploadSuccess,
  onDeleteSuccess = ignoreDeleteSuccess,
  resolveUploadErrorMessage = keepDefaultMessage,
  resolveDeleteErrorMessage = keepDefaultMessage,
  deleteRequest = requestDeleteWithFetch,
  reportFeedback,
  messages = {},
  uploadOptions = {},
  deleteMethod = "DELETE",
  source = "uploads-image-web.managed-image-asset",
  dependencies: {
    createImageUploadRuntimeFactory = createImageUploadRuntime,
    fetchImpl = globalThis.fetch.bind(globalThis)
  } = {}
}) {
  const { t, text } = useJskitText();
  const normalizedMessages = {
    ...DEFAULT_MANAGED_IMAGE_ASSET_MESSAGES,
    ...normalizeObject(messages)
  };
  const messageText = (name) => text(normalizedMessages[name]);
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
    if (!normalizedMessage) {
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
    selectedFileName.value = normalizeText(fileName);
  }

  async function runChangeHandler(handler, payload) {
    try {
      await Promise.resolve(handler(payload));
    } catch (error) {
      report({
        message: resolveMessage(error?.message, messageText("changeError")),
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
      fallbackMessage: messageText("uploadError")
    });

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
      fallbackMessage: messageText("deleteError")
    });

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
        closeDashboard(payload.uppy);
        updateSelectedFileName("");
        report({
          message: messageText("uploadSuccess"),
          severity: "success",
          channel: "snackbar",
          dedupeKey: `${source}:upload-success`
        });
        await runChangeHandler(onUploadSuccess, payload);
      },
      onInvalidResponse: () => {
        report({
          message: messageText("uploadInvalidResponse"),
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
          message: resolveMessage(error?.message, messageText("uploadRestriction")),
          severity: "error",
          channel: "banner",
          dedupeKey: `${source}:upload-restriction`
        });
      },
      onUnavailable: () => {
        report({
          message: messageText("editorUnavailable"),
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
    if (runtime) {
      runtime.setup();
    }
  }

  function openEditor() {
    const runtime = ensureUploadRuntime();
    if (!runtime) {
      report({
        message: messageText("endpointUnavailable"),
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
        message: messageText("deleteUnavailable"),
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
        const requestError = new Error(t("jskit.uploads.imageAsset.deleteRequestFailed"));
        requestError.response = response;
        requestError.body = body;
        throw requestError;
      }

      updateSelectedFileName("");
      report({
        message: messageText("deleteSuccess"),
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

  return {
    assetUrl,
    deleteAsset,
    destroy,
    hasAsset: normalizedHasAsset,
    isDeleting,
    openEditor,
    selectedFileName,
    setup
  };
}

export {
  createManagedImageAssetRuntime,
  DEFAULT_MANAGED_IMAGE_ASSET_MESSAGES
};
