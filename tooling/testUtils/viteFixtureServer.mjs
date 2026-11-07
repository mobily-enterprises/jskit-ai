// Starts one browser fixture's Vite dev server as `vite --config <file> --port <port>`
// does, optimizing dependencies into the cache directory startViteFixture chose.
import { createServer } from "vite";

const [configFile, port, cacheDir] = process.argv.slice(2);
const server = await createServer({
  configFile,
  cacheDir,
  clearScreen: false,
  server: { port: Number(port) }
});

await server.listen();
server.printUrls();
