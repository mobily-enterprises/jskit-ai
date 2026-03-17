import { normalizeText } from "./normalize.js";

const MATERIAL_SNACKBAR_PRESENTER_ID = "material.snackbar";
const MATERIAL_BANNER_PRESENTER_ID = "material.banner";
const MATERIAL_DIALOG_PRESENTER_ID = "material.dialog";
const MODULE_DEFAULT_PRESENTER_ID = MATERIAL_SNACKBAR_PRESENTER_ID;

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
    id: MATERIAL_SNACKBAR_PRESENTER_ID,
    channel: "snackbar",
    store,
    defaultPersist: false
  });
}

function createMaterialBannerPresenter({ store } = {}) {
  return createStoreBackedPresenter({
    id: MATERIAL_BANNER_PRESENTER_ID,
    channel: "banner",
    store,
    defaultPersist: true
  });
}

function createMaterialDialogPresenter({ store } = {}) {
  return createStoreBackedPresenter({
    id: MATERIAL_DIALOG_PRESENTER_ID,
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
  MATERIAL_SNACKBAR_PRESENTER_ID,
  MATERIAL_BANNER_PRESENTER_ID,
  MATERIAL_DIALOG_PRESENTER_ID,
  MODULE_DEFAULT_PRESENTER_ID,
  createStoreBackedPresenter,
  createMaterialSnackbarPresenter,
  createMaterialBannerPresenter,
  createMaterialDialogPresenter,
  createDefaultMaterialErrorPresenters
};
