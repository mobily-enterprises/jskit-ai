import { normalizeText } from "./normalize.js";

function createStoreBackedPresenter({
  id,
  channel,
  store,
  defaultPersist = false
} = {}) {
  const normalizedId = normalizeText(id);
  const normalizedChannel = normalizeText(channel).toLowerCase();
  if (!normalizedId) {
    throw new Error("createStoreBackedPresenter requires id.");
  }
  if (!normalizedChannel) {
    throw new Error(`createStoreBackedPresenter("${normalizedId}") requires channel.`);
  }
  if (!store || typeof store.present !== "function" || typeof store.dismiss !== "function") {
    throw new Error(`createStoreBackedPresenter("${normalizedId}") requires a presentation store.`);
  }

  return Object.freeze({
    id: normalizedId,
    supports(requestedChannel = "") {
      return String(requestedChannel || "").trim().toLowerCase() === normalizedChannel;
    },
    present(payload = {}) {
      return store.present(normalizedChannel, {
        ...payload,
        persist: typeof payload.persist === "boolean" ? payload.persist : defaultPersist,
        presenterId: normalizedId
      });
    },
    dismiss(presentationId = "") {
      return store.dismiss(normalizedChannel, String(presentationId || ""));
    }
  });
}

function createMaterialSnackbarPresenter({ store } = {}) {
  return createStoreBackedPresenter({
    id: "material.snackbar",
    channel: "snackbar",
    store,
    defaultPersist: false
  });
}

function createMaterialBannerPresenter({ store } = {}) {
  return createStoreBackedPresenter({
    id: "material.banner",
    channel: "banner",
    store,
    defaultPersist: true
  });
}

function createMaterialDialogPresenter({ store } = {}) {
  return createStoreBackedPresenter({
    id: "material.dialog",
    channel: "dialog",
    store,
    defaultPersist: true
  });
}

function createDefaultMaterialErrorPresenters({ store } = {}) {
  return Object.freeze([
    createMaterialSnackbarPresenter({ store }),
    createMaterialBannerPresenter({ store }),
    createMaterialDialogPresenter({ store })
  ]);
}

export {
  createStoreBackedPresenter,
  createMaterialSnackbarPresenter,
  createMaterialBannerPresenter,
  createMaterialDialogPresenter,
  createDefaultMaterialErrorPresenters
};
