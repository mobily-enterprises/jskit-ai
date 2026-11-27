// Run by test/browserFixtureTeardown.browser.test.js as its own `node --test` process, outside test/ so no run takes
// it as a test file of its own: one test ends while its route handler still holds a response it fetched, as a re-read
// the app starts just before a test ends does, so the shared fixture's teardown meets a handler in flight.
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sharedBrowserFixture } from "../../../../tooling/testUtils/browserFixture.mjs";

const open = sharedBrowserFixture({ fixtureRoot: fileURLToPath(new URL("../settings/", import.meta.url)) });

test("a route handler still holding its fetched response when the test ends", async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage();
  const closed = new Promise((resolve) => page.context().once("close", resolve));
  let fetched;
  const inFlight = new Promise((resolve) => { fetched = resolve; });
  await page.route("**/index.html", async (route) => {
    const response = await route.fetch();
    fetched();
    // jskit-test: fixed-wait - holds the handler until the fixture closes the test's context; the 2 s cap only ends a teardown that waits for running handlers
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 2_000).unref())]);
    await route.fulfill({ response, body: await response.text() });
  });
  page.goto(`${vite.baseURL}/index.html`).catch(() => {});
  await inFlight;
});
