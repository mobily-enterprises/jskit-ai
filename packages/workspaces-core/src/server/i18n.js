import { createServerI18n } from "@jskit-ai/kernel/server/i18n";
import en from "../../locales/en.json" with { type: "json" };

// Workspace texts rendered on the server (invitation emails) in the recipient's
// language, from the app's translations under appRoot, or English.
function createWorkspacesServerI18n({ appRoot = "" } = {}) {
  return createServerI18n({ appRoot, catalogs: [en] });
}

export { createWorkspacesServerI18n };
