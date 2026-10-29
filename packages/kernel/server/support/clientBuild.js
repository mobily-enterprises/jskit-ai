import { readFile } from "node:fs/promises";
import path from "node:path";
import { clientBuildIdFromHtml } from "../../shared/support/clientBuild.js";
import { resolveRequiredAppRoot } from "./path.js";

// The built page a JSKIT app server serves: Vite's default build output.
const SERVED_CLIENT_PAGE = path.join("dist", "index.html");

// The build of the page this app serves now, read each time so a page rebuilt
// while the server runs counts at once; "" when there is no built page.
async function readServedClientBuildId({ appRoot } = {}) {
  const pagePath = path.join(resolveRequiredAppRoot(appRoot, { context: "readServedClientBuildId" }), SERVED_CLIENT_PAGE);
  try {
    return clientBuildIdFromHtml(await readFile(pagePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export { readServedClientBuildId };
