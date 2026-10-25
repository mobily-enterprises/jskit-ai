import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { defineCrudListActions } from "./support/crudListActionSupport.js";

function defineCrudListRowActions(actions = []) {
  return defineCrudListActions(actions, {
    name: "defineCrudListRowActions",
    createAction: (rawAction, { key, label }) => ({
      key,
      label,
      icon: normalizeText(rawAction.icon),
      color: normalizeText(rawAction.color, { fallback: "primary" }),
      run: typeof rawAction.run === "function" ? rawAction.run : null,
      visible: rawAction.visible,
      disabled: rawAction.disabled,
      loading: rawAction.loading
    })
  });
}

export { defineCrudListRowActions };
