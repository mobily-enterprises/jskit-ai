import { reactive, ref, shallowRef } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockUppy {
    constructor(options) {
      this.options = options;
      this.handlers = new Map();
      this.pluginOptions = {};
      this.pluginInstances = {};
      this.clear = vi.fn();
      this.destroy = vi.fn();
    }

    use(plugin, options) {
      const pluginName = plugin?.name || "unknown";
      this.pluginOptions[pluginName] = options;

      if (pluginName === "Dashboard" && !this.pluginInstances.Dashboard) {
        this.pluginInstances.Dashboard = {
          openModal: vi.fn(),
          closeModal: vi.fn()
        };
      }

      if (pluginName === "ImageEditor" && !this.pluginInstances.ImageEditor) {
        this.pluginInstances.ImageEditor = {
          stop: vi.fn()
        };
      }

      return this;
    }

    on(eventName, callback) {
      this.handlers.set(eventName, callback);
      return this;
    }

    getPlugin(name) {
      return this.pluginInstances[name] || null;
    }

    emit(eventName, ...args) {
      const handler = this.handlers.get(eventName);
      if (handler) {
        handler(...args);
      }
    }
  }

  function Dashboard() {}
  function ImageEditor() {}
  function Compressor() {}
  function XHRUpload() {}

  return {
    MockUppy,
    Dashboard,
    ImageEditor,
    Compressor,
    XHRUpload,
    api: {
      session: vi.fn()
    }
  };
});

vi.mock("@uppy/core", () => ({
  default: mocks.MockUppy
}));
vi.mock("@uppy/dashboard", () => ({
  default: mocks.Dashboard
}));
vi.mock("@uppy/image-editor", () => ({
  default: mocks.ImageEditor
}));
vi.mock("@uppy/compressor", () => ({
  default: mocks.Compressor
}));
vi.mock("@uppy/xhr-upload", () => ({
  default: mocks.XHRUpload
}));
vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

import { useSettingsProfileLogic } from "../../src/views/settings/profile/lib/useSettingsProfileLogic.js";

function createHarness({ skipUploaderSetup = true } = {}) {
  const profileForm = reactive({
    displayName: "Tony",
    email: "tony@example.com"
  });
  const preferencesForm = reactive({
    avatarSize: 96
  });
  const profileAvatar = reactive({
    uploadedUrl: null,
    gravatarUrl: "",
    effectiveUrl: "",
    hasUploadedAvatar: false,
    size: 64,
    version: null
  });
  const selectedAvatarFileName = ref("");
  const avatarUppy = shallowRef(null);
  const profileFieldErrors = reactive({
    displayName: ""
  });
  const profileMessage = ref("");
  const profileMessageType = ref("success");
  const avatarMessage = ref("");
  const avatarMessageType = ref("success");
  const profileMutation = {
    mutateAsync: vi.fn()
  };
  const avatarDeleteMutation = {
    mutateAsync: vi.fn()
  };
  const queryClient = {
    setQueryData: vi.fn()
  };
  const authStore = {
    username: "Tony",
    setUsername: vi.fn()
  };
  const clearFieldErrors = vi.fn((errors) => {
    for (const key of Object.keys(errors)) {
      errors[key] = "";
    }
  });
  const toErrorMessage = vi.fn((error, fallback) => String(error?.message || fallback));
  const handleAuthError = vi.fn(async () => false);
  const applySettingsData = vi.fn();

  const logic = useSettingsProfileLogic({
    profileForm,
    preferencesForm,
    profileAvatar,
    selectedAvatarFileName,
    avatarUppy,
    profileFieldErrors,
    profileMessage,
    profileMessageType,
    avatarMessage,
    avatarMessageType,
    profileMutation,
    avatarDeleteMutation,
    settingsQueryKey: ["settings"],
    queryClient,
    authStore,
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    applySettingsData,
    skipUploaderSetup
  });

  return {
    profileForm,
    preferencesForm,
    profileAvatar,
    selectedAvatarFileName,
    avatarUppy,
    profileFieldErrors,
    profileMessage,
    profileMessageType,
    avatarMessage,
    avatarMessageType,
    profileMutation,
    avatarDeleteMutation,
    queryClient,
    authStore,
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    applySettingsData,
    logic
  };
}

describe("useSettingsProfileLogic", () => {
  beforeEach(() => {
    mocks.api.session.mockReset();
    mocks.api.session.mockResolvedValue({
      csrfToken: "csrf-token"
    });
  });

  it("derives profile initials and applies avatar data fallbacks", () => {
    const harness = createHarness();
    expect(harness.logic.profileInitials.value).toBe("TO");

    harness.profileForm.displayName = "";
    expect(harness.logic.profileInitials.value).toBe("TO");

    harness.logic.applyAvatarData(null);
    expect(harness.profileAvatar.uploadedUrl).toBe(null);
    expect(harness.profileAvatar.size).toBe(96);

    harness.logic.applyAvatarData({
      uploadedUrl: "https://cdn.example.com/avatar.png",
      gravatarUrl: "https://gravatar.example.com/abc",
      effectiveUrl: "https://cdn.example.com/avatar.png",
      hasUploadedAvatar: true,
      size: 128,
      version: 42
    });

    expect(harness.profileAvatar.uploadedUrl).toContain("cdn.example.com");
    expect(harness.profileAvatar.gravatarUrl).toContain("gravatar");
    expect(harness.profileAvatar.effectiveUrl).toContain("cdn.example.com");
    expect(harness.profileAvatar.hasUploadedAvatar).toBe(true);
    expect(harness.profileAvatar.size).toBe(128);
    expect(harness.profileAvatar.version).toBe("42");
  });

  it("skips uploader setup when blocked, unavailable, or already initialized", () => {
    const harness = createHarness({ skipUploaderSetup: true });
    harness.logic.setupAvatarUploader();
    expect(harness.avatarUppy.value).toBe(null);

    const originalWindow = globalThis.window;
    vi.stubGlobal("window", undefined);
    try {
      const noWindowHarness = createHarness({ skipUploaderSetup: false });
      noWindowHarness.logic.setupAvatarUploader();
      expect(noWindowHarness.avatarUppy.value).toBe(null);
    } finally {
      vi.stubGlobal("window", originalWindow);
    }

    const initializedHarness = createHarness({ skipUploaderSetup: false });
    initializedHarness.avatarUppy.value = {
      mock: true
    };
    initializedHarness.logic.setupAvatarUploader();
    expect(initializedHarness.avatarUppy.value).toEqual({ mock: true });
  });

  it("configures uploader callbacks, upload success, and helper handlers", async () => {
    const harness = createHarness({ skipUploaderSetup: false });
    harness.logic.setupAvatarUploader();
    const uppy = harness.avatarUppy.value;
    expect(uppy).toBeTruthy();

    const dashboard = uppy.getPlugin("Dashboard");
    const imageEditor = uppy.getPlugin("ImageEditor");

    uppy.emit("file-added", { name: "avatar-a.png" });
    expect(harness.selectedAvatarFileName.value).toBe("avatar-a.png");

    uppy.emit("file-editor:complete", { name: "avatar-b.png" });
    expect(harness.selectedAvatarFileName.value).toBe("avatar-b.png");
    expect(imageEditor.stop).toHaveBeenCalled();

    uppy.emit("file-editor:cancel");
    uppy.emit("dashboard:modal-closed");
    expect(imageEditor.stop).toHaveBeenCalledTimes(3);

    uppy.emit("file-removed");
    expect(harness.selectedAvatarFileName.value).toBe("");

    const xhrOptions = uppy.pluginOptions.XHRUpload;
    const setRequestHeader = vi.fn();
    await xhrOptions.onBeforeRequest({ setRequestHeader });
    expect(setRequestHeader).toHaveBeenCalledWith("csrf-token", "csrf-token");

    expect(xhrOptions.getResponseData({ responseText: "" })).toEqual({});
    expect(xhrOptions.getResponseData({ responseText: '{"ok":true}' })).toEqual({ ok: true });
    expect(xhrOptions.getResponseData({ responseText: "not-json" })).toEqual({});

    uppy.emit("upload-success", {}, null);
    expect(harness.avatarMessageType.value).toBe("error");
    expect(harness.avatarMessage.value).toContain("invalid");

    const payload = {
      profile: {
        displayName: "Tony"
      }
    };
    uppy.emit("upload-success", {}, { body: payload });
    expect(harness.queryClient.setQueryData).toHaveBeenCalledWith(["settings"], payload);
    expect(harness.applySettingsData).toHaveBeenCalledWith(payload);
    expect(dashboard.closeModal).toHaveBeenCalled();
    expect(harness.avatarMessageType.value).toBe("success");
    expect(harness.avatarMessage.value).toContain("uploaded");
  });

  it("handles uploader errors, restrictions, and completion cleanup", async () => {
    const harness = createHarness({ skipUploaderSetup: false });
    harness.logic.setupAvatarUploader();
    const uppy = harness.avatarUppy.value;

    uppy.emit("upload-error", {}, new Error("auth"), {
      status: 401,
      body: {
        error: "Authentication required."
      }
    });
    expect(harness.handleAuthError).toHaveBeenCalledWith({
      status: 401,
      message: "Authentication required."
    });

    uppy.emit("upload-error", {}, new Error("fallback"), {
      status: 400,
      body: {
        details: {
          fieldErrors: {
            avatar: "Avatar is invalid."
          }
        }
      }
    });
    expect(harness.avatarMessageType.value).toBe("error");
    expect(harness.avatarMessage.value).toContain("invalid");

    uppy.emit("restriction-failed", {}, new Error("Too large"));
    expect(harness.avatarMessage.value).toContain("Too large");

    uppy.emit("complete", {
      successful: []
    });
    expect(uppy.clear).not.toHaveBeenCalled();

    uppy.clear.mockImplementationOnce(() => {
      throw new Error("clear failed");
    });
    uppy.emit("complete", {
      successful: [{}]
    });
    expect(uppy.clear).toHaveBeenCalledTimes(1);
  });

  it("throws when csrf token cannot be resolved during upload request", async () => {
    const harness = createHarness({ skipUploaderSetup: false });
    harness.logic.setupAvatarUploader();
    const uppy = harness.avatarUppy.value;
    const xhrOptions = uppy.pluginOptions.XHRUpload;

    mocks.api.session.mockResolvedValueOnce({
      csrfToken: ""
    });
    await expect(xhrOptions.onBeforeRequest({ setRequestHeader: vi.fn() })).rejects.toThrow(
      "Unable to prepare secure avatar upload request."
    );
  });

  it("submits profile update and maps validation or auth failures", async () => {
    const harness = createHarness();
    harness.profileMutation.mutateAsync.mockResolvedValue({
      profile: {
        displayName: "Chiara"
      }
    });

    await harness.logic.submitProfile();

    expect(harness.queryClient.setQueryData).toHaveBeenCalled();
    expect(harness.applySettingsData).toHaveBeenCalled();
    expect(harness.authStore.setUsername).toHaveBeenCalledWith("Chiara");
    expect(harness.profileMessageType.value).toBe("success");
    expect(harness.profileMessage.value).toBe("Profile updated.");

    harness.profileMutation.mutateAsync.mockRejectedValue({
      message: "Validation failed.",
      fieldErrors: {
        displayName: "Display name too long."
      }
    });

    await harness.logic.submitProfile();
    expect(harness.profileFieldErrors.displayName).toContain("too long");
    expect(harness.profileMessageType.value).toBe("error");
    expect(harness.profileMessage.value).toContain("Validation failed");

    const authHarness = createHarness();
    authHarness.handleAuthError.mockResolvedValue(true);
    authHarness.profileMutation.mutateAsync.mockRejectedValue(new Error("auth"));
    await authHarness.logic.submitProfile();
    expect(authHarness.handleAuthError).toHaveBeenCalled();
  });

  it("opens avatar editor and handles unavailable/editor available branches", async () => {
    const blockedHarness = createHarness({ skipUploaderSetup: true });
    await blockedHarness.logic.openAvatarEditor();
    expect(blockedHarness.avatarMessageType.value).toBe("error");
    expect(blockedHarness.avatarMessage.value).toContain("unavailable");

    const harness = createHarness({ skipUploaderSetup: false });
    await harness.logic.openAvatarEditor();
    const dashboard = harness.avatarUppy.value.getPlugin("Dashboard");
    expect(dashboard.openModal).toHaveBeenCalledTimes(1);
  });

  it("deletes avatar and maps generic/auth errors", async () => {
    const harness = createHarness();
    harness.avatarDeleteMutation.mutateAsync.mockResolvedValue({
      profile: {
        displayName: "Tony"
      }
    });
    await harness.logic.submitAvatarDelete();
    expect(harness.queryClient.setQueryData).toHaveBeenCalled();
    expect(harness.applySettingsData).toHaveBeenCalled();
    expect(harness.avatarMessageType.value).toBe("success");
    expect(harness.avatarMessage.value).toBe("Avatar removed.");

    harness.avatarDeleteMutation.mutateAsync.mockRejectedValue(new Error("delete failed"));
    await harness.logic.submitAvatarDelete();
    expect(harness.avatarMessageType.value).toBe("error");
    expect(harness.avatarMessage.value).toContain("delete failed");

    const authHarness = createHarness();
    authHarness.handleAuthError.mockResolvedValue(true);
    authHarness.avatarDeleteMutation.mutateAsync.mockRejectedValue(new Error("auth"));
    await authHarness.logic.submitAvatarDelete();
    expect(authHarness.handleAuthError).toHaveBeenCalled();
  });
});
