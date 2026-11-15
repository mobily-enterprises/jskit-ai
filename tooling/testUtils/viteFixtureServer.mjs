// Starts one browser fixture's Vite dev server as `vite --config <file> --port <port>` does, optimizing dependencies
// into the cache directory startViteFixture chose, then warms it and says so (WARM_LINE).
import { createServer } from "vite";

const WARM_LINE = "jskit fixture server warm";

const [configFile, port, cacheDir] = process.argv.slice(2);
const server = await createServer({
  configFile,
  cacheDir,
  clearScreen: false,
  server: { port: Number(port) }
});

await server.listen();
server.printUrls();

// A cold server transforms the app's modules and optimizes its dependencies while the first page load asks for them,
// inside a test's first navigation: 2-4 s on an idle machine, past a navigation's limit on a loaded one. The server
// transforms them here instead: the page's module scripts, then every module each transformed one imports, the
// optimized dependencies among them. Neither the page request nor Vite's warmupRequest reaches them on its own (Vite
// pre-transforms no script from the page, and only part of the imports below one). A module that fails to transform
// is left for the page to report, as it would without this.
const client = server.environments.client;
const warmed = new Set();
async function warm(url) {
  if (warmed.has(url)) return;
  warmed.add(url);
  try {
    await client.transformRequest(url);
  } catch {
    return;
  }
  const module = await client.moduleGraph.getModuleByUrl(url);
  await Promise.all([...(module?.importedModules ?? [])].map((imported) => warm(imported.url)));
}
const page = await (await fetch(server.resolvedUrls.local[0], { headers: { accept: "text/html" } })).text();
await Promise.all([...page.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/gu)].map((match) => warm(match[1])));
console.log(WARM_LINE);
