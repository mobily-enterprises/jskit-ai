import { supabaseDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const supabaseProvider = Object.freeze({
  ...supabaseDefinition, apiOrigins: ["https://api.supabase.com"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "projects.list",
  operations: {
    "projects.list": jsonOperation("https://api.supabase.com/v1/projects", {},
      (result) => Array.isArray(result) && result.every((item) => typeof item?.id === "string" && typeof item.name === "string"))
  }
});
export { supabaseProvider };
