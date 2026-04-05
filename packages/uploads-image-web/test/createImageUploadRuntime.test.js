import assert from "node:assert/strict";
import test from "node:test";
import { createImageUploadRuntime } from "../src/client/composables/createImageUploadRuntime.js";

class FakeUppy {
  constructor(options) {
    this.options = options;
    this.plugins = new Map();
    this.pluginOptions = new Map();
    this.eventHandlers = new Map();
    this.clearCount = 0;
    this.destroyCount = 0;
  }

  use(plugin, options) {
    const pluginName = String(plugin?.name || plugin?.pluginName || "");
    this.pluginOptions.set(pluginName, options);

    if (pluginName === "Dashboard") {
      this.plugins.set("Dashboard", {
        openCount: 0,
        closeCount: 0,
        openModal() {
          this.openCount += 1;
        },
        closeModal() {
          this.closeCount += 1;
        }
      });
    } else if (pluginName === "ImageEditor") {
      this.plugins.set("ImageEditor", {
        stopCount: 0,
        stop() {
          this.stopCount += 1;
        }
      });
    }

    return this;
  }

  on(eventName, handler) {
    this.eventHandlers.set(eventName, handler);
    return this;
  }

  getPlugin(name) {
    return this.plugins.get(name) || null;
  }

  clear() {
    this.clearCount += 1;
  }

  destroy() {
    this.destroyCount += 1;
  }
}

function setWindowStub() {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  return () => {
    if (previousWindow === undefined) {
      delete globalThis.window;
      return;
    }
    globalThis.window = previousWindow;
  };
}

test("createImageUploadRuntime wires headers and lifecycle callbacks", async () => {
  const restoreWindow = setWindowStub();
  let fakeUppy = null;

  try {
    const fileNames = [];
    const successPayloads = [];
    const invalidResponses = [];
    const unavailableCalls = [];
    const restrictionFailures = [];
    const uploadErrors = [];

    const runtime = createImageUploadRuntime({
      endpoint: "/api/upload",
      fieldName: "avatar",
      resolveRequestHeaders: async () => ({
        "csrf-token": "csrf-1"
      }),
      onSelectedFileNameChanged: (name) => {
        fileNames.push(name);
      },
      onUploadSuccess: (payload) => {
        successPayloads.push(payload.data);
      },
      onInvalidResponse: (payload) => {
        invalidResponses.push(payload.response?.body || null);
      },
      onUploadError: (payload) => {
        uploadErrors.push(payload.error?.message || "");
      },
      onRestrictionFailed: (payload) => {
        restrictionFailures.push(payload.error?.message || "");
      },
      onUnavailable: () => {
        unavailableCalls.push(true);
      },
      dependencies: {
        UppyClass: class extends FakeUppy {
          constructor(options) {
            super(options);
            fakeUppy = this;
          }
        },
        DashboardPlugin: { name: "Dashboard" },
        ImageEditorPlugin: { name: "ImageEditor" },
        CompressorPlugin: { name: "Compressor" },
        XHRUploadPlugin: { name: "XHRUpload" }
      }
    });

    runtime.setup();
    runtime.openEditor();

    assert.ok(fakeUppy);
    const pluginOptions = fakeUppy.pluginOptions || new Map();
    const xhrOptions = pluginOptions.get("XHRUpload");

    const headers = [];
    await xhrOptions.onBeforeRequest({
      setRequestHeader(name, value) {
        headers.push([name, value]);
      }
    });
    assert.deepEqual(headers, [["csrf-token", "csrf-1"]]);

    fakeUppy.eventHandlers.get("file-added")({ name: "face.png" });
    fakeUppy.eventHandlers.get("file-editor:complete")({ name: "face-edited.png" });
    fakeUppy.eventHandlers.get("upload-success")({}, { body: { ok: true } });
    fakeUppy.eventHandlers.get("upload-success")({}, { body: "" });
    fakeUppy.eventHandlers.get("upload-error")({}, new Error("boom"), {});
    fakeUppy.eventHandlers.get("restriction-failed")({}, new Error("nope"));
    fakeUppy.eventHandlers.get("complete")({ successful: [{}] });

    assert.deepEqual(fileNames, ["face.png", "face-edited.png", ""]);
    assert.deepEqual(successPayloads, [{ ok: true }]);
    assert.deepEqual(invalidResponses, [null]);
    assert.deepEqual(uploadErrors, ["boom"]);
    assert.deepEqual(restrictionFailures, ["nope"]);
    assert.equal(fakeUppy.clearCount, 1);

    runtime.destroy();
    assert.equal(fakeUppy.destroyCount, 1);
    assert.deepEqual(unavailableCalls, []);
  } finally {
    restoreWindow();
  }
});

test("createImageUploadRuntime reports unavailable editor outside browser environments", () => {
  const unavailableCalls = [];

  const runtime = createImageUploadRuntime({
    onUnavailable: () => {
      unavailableCalls.push(true);
    }
  });

  runtime.openEditor();
  assert.deepEqual(unavailableCalls, [true]);
});
