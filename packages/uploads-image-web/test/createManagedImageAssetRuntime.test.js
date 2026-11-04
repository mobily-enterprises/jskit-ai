import assert from "node:assert/strict";
import test from "node:test";
import { reactive, ref } from "vue";
import { createManagedImageAssetRuntime } from "../src/client/composables/createManagedImageAssetRuntime.js";

function createFakeUploadRuntimeFactory(createdRuntimes) {
  return (options = {}) => {
    const runtime = {
      options,
      destroyCount: 0,
      openCount: 0,
      setupCount: 0,
      destroy() {
        this.destroyCount += 1;
      },
      openEditor() {
        this.openCount += 1;
      },
      setup() {
        this.setupCount += 1;
      }
    };

    createdRuntimes.push(runtime);
    return runtime;
  };
}

function createJsonResponse(body, { ok = true } = {}) {
  return {
    ok,
    headers: {
      get(name) {
        return String(name || "").toLowerCase() === "content-type" ? "application/json" : "";
      }
    },
    async json() {
      return body;
    }
  };
}

test("createManagedImageAssetRuntime reuses the shared upload lifecycle and delete flow", async () => {
  const createdRuntimes = [];
  const feedbackEvents = [];
  const changedEvents = [];
  const fetchCalls = [];
  const selectedFileName = ref("");
  const uploadEndpoint = ref("/api/pets/1/photo");
  const assetVersion = ref("9");
  const hasAsset = ref(true);

  const runtime = createManagedImageAssetRuntime({
    uploadEndpoint,
    fieldName: "photo",
    hasAsset,
    assetVersion,
    selectedFileName,
    resolveAssetUrl: ({ uploadEndpoint: endpoint, assetVersion: version }) =>
      version ? `${endpoint}?v=${version}` : endpoint,
    resolveRequestHeaders: async ({ action }) => ({
      "csrf-token": `csrf-${action}`
    }),
    onUploadSuccess: async ({ data }) => {
      changedEvents.push(["upload", data]);
    },
    onDeleteSuccess: async ({ data }) => {
      changedEvents.push(["delete", data]);
    },
    reportFeedback: (payload) => {
      feedbackEvents.push(payload);
    },
    messages: {
      uploadSuccess: "Photo uploaded.",
      deleteSuccess: "Photo removed."
    },
    dependencies: {
      createImageUploadRuntimeFactory: createFakeUploadRuntimeFactory(createdRuntimes),
      fetchImpl: async (url, options = {}) => {
        fetchCalls.push([url, options]);
        return createJsonResponse({ ok: true });
      }
    }
  });

  assert.equal(runtime.assetUrl.value, "/api/pets/1/photo?v=9");

  runtime.setup();
  runtime.openEditor();
  assert.equal(createdRuntimes.length, 1);
  assert.equal(createdRuntimes[0].setupCount, 1);
  assert.equal(createdRuntimes[0].openCount, 1);
  assert.equal(createdRuntimes[0].options.fieldName, "photo");

  createdRuntimes[0].options.onSelectedFileNameChanged("pet.png");
  assert.equal(selectedFileName.value, "pet.png");

  const dashboard = {
    closeCount: 0,
    closeModal() {
      this.closeCount += 1;
    }
  };
  await createdRuntimes[0].options.onUploadSuccess({
    data: { id: "pet-1" },
    uppy: {
      getPlugin(name) {
        return name === "Dashboard" ? dashboard : null;
      }
    }
  });

  assert.equal(selectedFileName.value, "");
  assert.equal(dashboard.closeCount, 1);
  assert.deepEqual(changedEvents, [["upload", { id: "pet-1" }]]);
  assert.equal(feedbackEvents.at(-1)?.message, "Photo uploaded.");

  await runtime.deleteAsset();

  assert.equal(runtime.isDeleting.value, false);
  assert.deepEqual(fetchCalls, [
    [
      "/api/pets/1/photo",
      {
        method: "DELETE",
        credentials: "include",
        headers: {
          "csrf-token": "csrf-delete"
        }
      }
    ]
  ]);
  assert.deepEqual(changedEvents, [
    ["upload", { id: "pet-1" }],
    ["delete", { ok: true }]
  ]);
  assert.equal(feedbackEvents.at(-1)?.message, "Photo removed.");

  uploadEndpoint.value = "/api/pets/2/photo";
  runtime.openEditor();

  assert.equal(createdRuntimes.length, 2);
  assert.equal(createdRuntimes[0].destroyCount, 1);
  assert.equal(createdRuntimes[1].openCount, 1);
  assert.equal(createdRuntimes[1].options.endpoint, "/api/pets/2/photo");
});

test("createManagedImageAssetRuntime reports configured upload and delete errors", async () => {
  const createdRuntimes = [];
  const feedbackEvents = [];

  const runtime = createManagedImageAssetRuntime({
    uploadEndpoint: "/api/pets/1/photo",
    fieldName: "photo",
    resolveRequestHeaders: async () => ({}),
    reportFeedback: (payload) => {
      feedbackEvents.push(payload);
    },
    resolveUploadErrorMessage: ({ response, defaultMessage }) =>
      response?.body?.fieldErrors?.photo || defaultMessage,
    resolveDeleteErrorMessage: ({ body, defaultMessage }) =>
      body?.fieldErrors?.photo || defaultMessage,
    dependencies: {
      createImageUploadRuntimeFactory: createFakeUploadRuntimeFactory(createdRuntimes),
      fetchImpl: async () =>
        createJsonResponse(
          {
            fieldErrors: {
              photo: "Cannot delete this photo."
            }
          },
          { ok: false }
        )
    }
  });

  runtime.openEditor();
  createdRuntimes[0].options.onUploadError({
    error: {
      message: "Request failed."
    },
    response: {
      body: {
        fieldErrors: {
          photo: "Selected photo is invalid."
        }
      }
    }
  });

  await runtime.deleteAsset();

  assert.deepEqual(
    feedbackEvents.map((entry) => entry.message),
    ["Selected photo is invalid.", "Cannot delete this photo."]
  );
});

test("createManagedImageAssetRuntime needs only what every application supplies", async () => {
  const createdRuntimes = [];
  const feedbackEvents = [];
  const fetchCalls = [];

  const runtime = createManagedImageAssetRuntime({
    uploadEndpoint: "/api/pets/1/photo",
    hasAsset: true,
    resolveRequestHeaders: async () => ({}),
    onUploadSuccess() {},
    reportFeedback: (payload) => {
      feedbackEvents.push(payload);
    },
    dependencies: {
      createImageUploadRuntimeFactory: createFakeUploadRuntimeFactory(createdRuntimes),
      fetchImpl: async (url, options) => {
        fetchCalls.push([url, options.method]);
        return createJsonResponse({ ok: true });
      }
    }
  });

  assert.equal(runtime.assetUrl.value, "/api/pets/1/photo");

  runtime.setup();
  createdRuntimes[0].options.onSelectedFileNameChanged("pet.png");
  assert.equal(runtime.selectedFileName.value, "pet.png");

  await runtime.deleteAsset();

  assert.deepEqual(fetchCalls, [["/api/pets/1/photo", "DELETE"]]);
  assert.equal(runtime.selectedFileName.value, "");
  assert.deepEqual(feedbackEvents.map((entry) => entry.severity), ["success"]);
});

test("createManagedImageAssetRuntime does nothing on setup without an upload endpoint", () => {
  const createdRuntimes = [];

  const runtime = createManagedImageAssetRuntime({
    resolveRequestHeaders: async () => ({}),
    onUploadSuccess() {},
    reportFeedback() {},
    dependencies: {
      createImageUploadRuntimeFactory: createFakeUploadRuntimeFactory(createdRuntimes)
    }
  });

  runtime.setup();
  assert.deepEqual(createdRuntimes, []);
});

test("createManagedImageAssetRuntime holds refs a caller can read through reactive state", () => {
  const runtime = reactive(createManagedImageAssetRuntime({
    uploadEndpoint: "/api/pets/1/photo",
    hasAsset: true,
    resolveRequestHeaders: async () => ({}),
    onUploadSuccess() {},
    reportFeedback() {},
    dependencies: {
      createImageUploadRuntimeFactory: createFakeUploadRuntimeFactory([])
    }
  }));

  assert.equal(runtime.assetUrl, "/api/pets/1/photo");
  assert.equal(runtime.isDeleting, false);
});
