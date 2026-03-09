import { useAccountAddEdit } from "./useAccountAddEdit.js";

function useGlobalAddEdit(options = {}) {
  const source = options && typeof options === "object" ? options : {};

  return useAccountAddEdit({
    placementSource: "users-web.global.add-edit",
    ...source
  });
}

export { useGlobalAddEdit };
