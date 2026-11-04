import { computed, createApp, h, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import "../../src/client/styles/index.js";
import { createImageUploadRuntime } from "../../src/client/composables/createImageUploadRuntime.js";
import { createManagedImageAssetRuntime } from "../../src/client/composables/createManagedImageAssetRuntime.js";

let csrfToken = "";

async function readCsrfToken() {
  if (!csrfToken) {
    const response = await fetch("/api/session", { credentials: "include" });
    csrfToken = String((await response.json()).csrfToken || "");
  }
  return csrfToken;
}

function renderList(className, entries) {
  return h("ul", { class: className }, entries.map((entry) => h("li", entry)));
}

// users-web's account avatar: the options accountSettingsAvatarUploadRuntime.js passes, plus the asset and delete
// options the managed runtime offers for removing it.
const AvatarPage = {
  setup() {
    const feedback = reactive([]);
    const settings = reactive({ avatarVersion: "1" });
    const selectedAvatarFileName = ref("");
    const avatar = createManagedImageAssetRuntime({
      uploadEndpoint: "/api/settings/profile/avatar",
      fieldName: "avatar",
      selectedFileName: selectedAvatarFileName,
      resolveRequestHeaders: async () => ({
        "csrf-token": await readCsrfToken()
      }),
      onUploadSuccess: ({ data }) => {
        settings.avatarVersion = String(data.profile.avatar.version);
      },
      reportFeedback: (entry) => {
        feedback.push(`${entry.severity} ${entry.channel}: ${entry.message}`);
      },
      resolveUploadErrorMessage: ({ error, response, defaultMessage }) => {
        const body = response?.body && typeof response.body === "object" ? response.body : {};
        return String(body.fieldErrors?.avatar || body.error || error?.message || defaultMessage);
      },
      messages: {
        uploadSuccess: "Avatar uploaded.",
        uploadError: "Unable to upload the avatar."
      },
      source: "fixture.account-settings:avatar",
      hasAsset: computed(() => Boolean(settings.avatarVersion)),
      assetVersion: computed(() => settings.avatarVersion),
      resolveAssetUrl: ({ uploadEndpoint, assetVersion }) => `${uploadEndpoint}?v=${assetVersion}`,
      onDeleteSuccess: () => {
        settings.avatarVersion = "";
      }
    });
    onMounted(() => avatar.setup());
    onBeforeUnmount(() => avatar.destroy());

    return () => h("main", [
      h("button", { type: "button", onClick: () => avatar.openEditor() }, "Change avatar"),
      h("button", {
        type: "button",
        disabled: avatar.isDeleting.value || !avatar.hasAsset.value,
        onClick: () => avatar.deleteAsset()
      }, avatar.isDeleting.value ? "Removing…" : "Remove avatar"),
      h("p", { class: "fixture-selected" }, `Selected: ${avatar.selectedFileName.value || "nothing"}`),
      h("p", { class: "fixture-asset" }, `Asset: ${avatar.assetUrl.value || "none"}`),
      renderList("fixture-feedback", feedback)
    ]);
  }
};

// The upload runtime as whs2 calls it: an endpoint and the four callbacks every application supplies, leaving
// onSelectedFileNameChanged, onInvalidResponse and onUnavailable to their defaults.
const SignaturePage = {
  setup() {
    const events = reactive([]);
    const signature = createImageUploadRuntime({
      endpoint: "/api/signature",
      resolveRequestHeaders: async () => ({
        "csrf-token": await readCsrfToken(),
        "x-fixture-unset": null
      }),
      onUploadSuccess: ({ data, file }) => {
        events.push(`success ${file.name}: ${JSON.stringify(data)}`);
      },
      onUploadError: ({ file, error, response }) => {
        events.push(`error ${file.name} ${response?.status}: ${error.message}`);
      },
      onRestrictionFailed: ({ file, error }) => {
        events.push(`restriction ${file?.name}: ${error.message}`);
      }
    });
    onMounted(() => signature.setup());
    onBeforeUnmount(() => signature.destroy());

    return () => h("main", [
      h("button", { type: "button", onClick: () => signature.openEditor() }, "Upload signature"),
      renderList("fixture-events", events)
    ]);
  }
};

const pages = { "/avatar": AvatarPage, "/signature": SignaturePage };
createApp(pages[window.location.pathname] || { render: () => h("p", "No such fixture page.") }).mount("#app");
