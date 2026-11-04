import { pagePathname } from "../browser.js";

function resolveRuntimePathname(candidate = "") {
  const explicitPathname = String(candidate || "").trim();
  return explicitPathname || pagePathname() || "/";
}

export { resolveRuntimePathname };
