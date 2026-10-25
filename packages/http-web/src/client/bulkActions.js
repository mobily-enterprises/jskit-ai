import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { defineCrudListActions } from "./support/crudListActionSupport.js";

function defineCrudListBulkActions(actions = []) {
  return defineCrudListActions(actions, {
    name: "defineCrudListBulkActions",
    createAction: (rawAction, { key, label }) => ({
      key,
      label,
      icon: normalizeText(rawAction.icon),
      color: normalizeText(rawAction.color, { fallback: "primary" }),
      variant: normalizeText(rawAction.variant, { fallback: "tonal" }),
      confirmLabel: normalizeText(rawAction.confirmLabel),
      run: typeof rawAction.run === "function" ? rawAction.run : null,
      disabled: rawAction.disabled
    })
  });
}

export { defineCrudListBulkActions };
