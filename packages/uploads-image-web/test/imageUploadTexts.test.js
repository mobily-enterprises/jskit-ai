import assert from "node:assert/strict";
import test from "node:test";
import { createI18n } from "vue-i18n";
import { setJskitI18n } from "@jskit-ai/kernel/client";
import { createImageUploadRuntime } from "../src/client/composables/createImageUploadRuntime.js";
import { createManagedImageAssetRuntime } from "../src/client/composables/createManagedImageAssetRuntime.js";

function captureDashboardNote(options = {}) {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  let note = "";
  try {
    createImageUploadRuntime({
      ...options,
      endpoint: "/api/upload",
      dependencies: {
        UppyClass: class {
          use(plugin, pluginOptions) {
            if (plugin.name === "Dashboard") note = pluginOptions.note;
            return this;
          }
          on() {
            return this;
          }
        },
        DashboardPlugin: { name: "Dashboard" },
        ImageEditorPlugin: { name: "ImageEditor" },
        CompressorPlugin: { name: "Compressor" },
        XHRUploadPlugin: { name: "XHRUpload" }
      }
    }).setup();
  } finally {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
  return note;
}

function createManagedRuntime(feedbackEvents, options = {}) {
  return createManagedImageAssetRuntime({
    reportFeedback: (payload) => feedbackEvents.push(payload.message),
    dependencies: {
      createImageUploadRuntimeFactory: (runtimeOptions) => ({
        options: runtimeOptions,
        destroy() {},
        openEditor() {},
        setup() {}
      })
    },
    ...options
  });
}

test("the upload dashboard note keeps its English", () => {
  assert.equal(
    captureDashboardNote({ allowedMimeTypes: ["image/png", "image/jpeg"], maxUploadBytes: 2 * 1024 * 1024 }),
    "Accepted: image/png, image/jpeg, max 2MB"
  );
  assert.equal(captureDashboardNote({ note: "Square photos only." }), "Square photos only.");
});

test("managed image feedback keeps its English and accepts message keys", async () => {
  const feedbackEvents = [];
  createManagedRuntime(feedbackEvents).openEditor();
  createManagedRuntime(feedbackEvents, {
    uploadEndpoint: "/api/photo",
    deleteRequest: async () => ({ body: null, response: { ok: false } })
  }).deleteAsset();
  await new Promise((resolve) => setImmediate(resolve));
  createManagedRuntime(feedbackEvents, { messages: { endpointUnavailable: "jskit.uploads.imageAsset.deleteUnavailable" } }).openEditor();

  assert.deepEqual(feedbackEvents, [
    "Image endpoint is unavailable.",
    "Image delete request failed.",
    "Image removal is unavailable."
  ]);
});

test("managed image upload errors show a coded server error in the app's language", () => {
  setJskitI18n(createI18n({
    legacy: false,
    locale: "it",
    messages: {
      it: {
        jskit: {
          errors: { validation_failed: "Convalida non riuscita." },
          uploads: { imageAsset: { uploadSuccess: "Immagine caricata." } }
        }
      }
    }
  }));
  try {
    const feedbackEvents = [];
    const created = [];
    const runtime = createManagedRuntime(feedbackEvents, {
      uploadEndpoint: "/api/photo",
      dependencies: {
        createImageUploadRuntimeFactory: (runtimeOptions) => {
          const fake = { options: runtimeOptions, destroy() {}, openEditor() {}, setup() {} };
          created.push(fake);
          return fake;
        }
      }
    });
    runtime.openEditor();
    created[0].options.onUploadError({
      error: { message: "Request failed." },
      response: { body: { error: "Validation failed.", code: "validation_failed", params: {} } }
    });
    created[0].options.onUploadError({
      error: { message: "Request failed." },
      response: { body: { error: "Photo is blurry.", code: "validation_failed", params: {} } }
    });
    created[0].options.onUploadSuccess({ data: {} });

    assert.deepEqual(feedbackEvents, ["Convalida non riuscita.", "Photo is blurry.", "Immagine caricata."]);
  } finally {
    setJskitI18n(null);
  }
});
