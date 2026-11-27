import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { sharedBrowserFixture } from "../../../tooling/testUtils/browserFixture.mjs";

// A page's navigation can depend on context an application loads after the page opens, such as the permissions of a
// session of its own (mobilynet's console merges its staff permissions once its console session arrives). ShellLayout
// drew the drawer, the rail, the navigation bar and the app bar's menu control only when they arrived, so what a person
// was reaching for moved under the pointer as the page opened: mobilynet's Builds tab jumped from about x=69 to x=430
// in the middle of a click, and the click landed in the drawer. The fixture's console page (App.vue) loads its
// session's permissions after it opens; each case holds that response, so they arrive late on purpose, records where
// each target is first seen, lets the response go, clicks at once where the target was first seen, and checks that
// nothing moved once seen and that the click reached the target.
const SKIP = process.env.JSKIT_SHELL_WEB_BROWSER_INTEGRATION === "1"
  ? false
  : "set JSKIT_SHELL_WEB_BROWSER_INTEGRATION=1 to check the shell's navigation never moves the page under a person's pointer";
const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/adaptive-shell");
const open = sharedBrowserFixture({ fixtureRoot: FIXTURE_ROOT, configFile: "vite.config.mjs" });
const EXPANDED = Object.freeze({ width: 1280, height: 900 });
const MEDIUM = Object.freeze({ width: 768, height: 1024 });
const COMPACT = Object.freeze({ width: 390, height: 844 });
const ALL_PERMISSIONS = Object.freeze(["builds.read", "machines.read", "alerts.read"]);
// The files of Roboto Flex, the typeface material.css gives the page (font-display: swap): the drawer fits its labels
// in it.
const ROBOTO_FLEX_FILES = "**/roboto-flex-*.woff2";
// How long the font cases hold Roboto Flex: as a slow connection would.
const SLOW_FONT_MS = 3_000;
const TARGETS = Object.freeze({
  builds: "[data-testid='fixture-console-builds']",
  newBuild: "[data-testid='fixture-console-new-build'] .v-btn",
  title: "[data-testid='jskit-shell-page-title']",
  validate: "button[type='submit']"
});

// Runs in the page before the app: at every frame, where each target is (rounded to the pixel) while a person can see
// it, its first such place (with when, by the page's clock) and its latest; and what each click landed on. A click on anything but a target stops
// there, so a missed click changes nothing on the page.
function watchPlaces(targets) {
  const first = {};
  const last = {};
  const hits = [];
  function placeOf(element) {
    if (!element?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
      return null;
    }
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) {
      return null;
    }
    return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
  }
  function sample() {
    for (const [name, selector] of Object.entries(targets)) {
      const place = placeOf(document.querySelector(selector));
      if (place) {
        first[name] ??= { ...place, at: performance.now() };
        last[name] = place;
      }
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
  window.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const target = Object.keys(targets).find((name) => element?.closest(targets[name]));
    if (target) {
      hits.push(target);
      return;
    }
    const part = element?.closest("[data-testid]")?.getAttribute("data-testid") || element?.tagName || "nothing";
    const control = element?.closest("a, button")?.textContent.trim();
    hits.push(control ? `${part} (${control})` : part);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  globalThis.__shellPlaces = { first, last, hits };
}

async function frames(page, count) {
  await page.evaluate((remaining) => new Promise((resolve) => {
    const step = () => (--remaining <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  }), count);
}

const places = (page) => page.evaluate(() => globalThis.__shellPlaces);

// Opens `url` with the console session's response held until `release()`, which answers it with `permissions` once the
// page's fonts are in, as they usually are by then: so these cases are about the session, and the font cases below about
// the font.
async function openHeld(t, { viewport, url = "/console/builds", targets, permissions = ALL_PERMISSIONS }) {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport });
  await page.addInitScript(watchPlaces, Object.fromEntries(targets.map((name) => [name, TARGETS[name]])));
  let release = () => {};
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let asked = () => {};
  const sessionAsked = new Promise((resolve) => {
    asked = resolve;
  });
  await page.route("**/api/fixture/console-session", async (route) => {
    asked();
    await held;
    await route.fulfill({ json: { permissions } });
  });
  await page.goto(url);
  await sessionAsked;
  await expect(page.getByTestId("fixture-console-builds")).toBeAttached();
  // The page as it is drawn while the session is held, for a few frames.
  await frames(page, 5);
  return {
    page,
    async release() {
      await page.evaluate(() => document.fonts.ready.then(() => true));
      release();
    }
  };
}

// Opens /home at the expanded size, its drawer fitted to its labels, with Roboto Flex held until `releaseFonts()`
// (`fonts: "held"`) or failed at once (`fonts: "failed"`); either way the page never gets it.
async function openHome(t, { fonts, targets }) {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: EXPANDED });
  await page.addInitScript(watchPlaces, Object.fromEntries(targets.map((name) => [name, TARGETS[name]])));
  let releaseFonts = () => {};
  const held = new Promise((resolve) => {
    releaseFonts = resolve;
  });
  let asked = () => {};
  const fontAsked = new Promise((resolve) => {
    asked = resolve;
  });
  await page.route(ROBOTO_FLEX_FILES, async (route) => {
    asked(Date.now());
    if (fonts === "held") {
      await held;
    }
    await route.abort().catch(() => {});
  });
  // Not waiting for the load event, which a held font may hold too.
  await page.goto("/home", { waitUntil: "domcontentloaded" });
  const fontAskedAt = await fontAsked;
  await expect(page.getByTestId("jskit-shell-drawer")).toHaveAttribute("data-drawer-width-mode", "content");
  return { page, fontAskedAt, releaseFonts };
}

// Clicks at once at the middle of where `name` was first seen, as a person who aimed at it then does; `timeout` is how
// long it may take to show.
async function clickWhereFirstSeen(page, name, { timeout } = {}) {
  await expect.poll(async () => Boolean((await places(page)).first[name]), {
    message: `${name} never showed`,
    timeout
  }).toBe(true);
  const place = (await places(page)).first[name];
  const point = { x: place.x + place.width / 2, y: place.y + place.height / 2 };
  await page.mouse.click(point.x, point.y);
  return point;
}

// Waits until nothing on the page animates any more (the layout's slide, a ripple), then a few frames.
async function settle(page) {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
  await frames(page, 5);
}

// Each target is where it was first seen, and the click made where `clicked` first showed reached it.
async function assertNothingMoved(page, { targets, clicked, point }) {
  const { first, last, hits } = await places(page);
  const problems = [];
  for (const name of targets) {
    if (!first[name]) {
      problems.push(`${name} never showed`);
      continue;
    }
    const [from, to] = [first[name], last[name]];
    if (Math.abs(from.x - to.x) > 1 || Math.abs(from.y - to.y) > 1) {
      problems.push(`${name} moved after it showed, from x=${from.x} y=${from.y} to x=${to.x} y=${to.y}`);
    }
  }
  if (clicked && hits[0] !== clicked) {
    problems.push(
      `the click at x=${Math.round(point.x)} y=${Math.round(point.y)}, where ${clicked} first showed, landed on ` +
      `${hits[0] || "nothing"} instead`
    );
  }
  assert.deepEqual(problems, []);
}

test("expanded window: the drawer a late session brings never moves the content or the title, nor takes their click", {
  skip: SKIP,
  timeout: 90_000
}, async (t) => {
  const targets = ["builds", "title"];
  const { page, release } = await openHeld(t, { viewport: EXPANDED, targets });
  // Until the session answers, the console has only its Console entry: no drawer, and no destination it may not use.
  await expect(page.getByTestId("jskit-shell-drawer")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Machines" })).toHaveCount(0);

  await release();
  await expect(page.getByTestId("jskit-shell-drawer")).toBeAttached();
  const point = await clickWhereFirstSeen(page, "builds");
  await settle(page);

  await expect(page.getByTestId("jskit-shell-drawer").getByRole("link", { name: "Machines" })).toBeVisible();
  await assertNothingMoved(page, { targets, clicked: "builds", point });
});

test("medium window: the navigation rail a late session brings never moves the content or the title, nor takes their click", {
  skip: SKIP,
  timeout: 90_000
}, async (t) => {
  const targets = ["builds", "title"];
  const { page, release } = await openHeld(t, { viewport: MEDIUM, targets });
  await expect(page.getByTestId("jskit-shell-rail")).toHaveCount(0);

  await release();
  await expect(page.getByTestId("jskit-shell-rail")).toBeAttached();
  const point = await clickWhereFirstSeen(page, "builds");
  await settle(page);

  await expect(page.getByTestId("jskit-shell-rail").getByRole("link", { name: "Machines" })).toBeVisible();
  await assertNothingMoved(page, { targets, clicked: "builds", point });
});

test("compact window: the navigation bar and the app bar's menu control a late session brings never move the FAB, the title or the content, nor take the FAB's click", {
  skip: SKIP,
  timeout: 90_000
}, async (t) => {
  const targets = ["newBuild", "title", "builds"];
  const { page, release } = await openHeld(t, { viewport: COMPACT, targets });
  await expect(page.getByTestId("jskit-shell-bottom-nav")).toHaveCount(0);
  await expect(page.getByTestId("jskit-shell-nav-toggle")).toHaveCount(0);

  await release();
  await expect(page.getByTestId("jskit-shell-bottom-nav")).toBeAttached();
  const point = await clickWhereFirstSeen(page, "newBuild");
  await settle(page);

  await expect(page.getByTestId("jskit-shell-bottom-nav").getByRole("link", { name: "Machines" })).toBeVisible();
  await expect(page.getByTestId("jskit-shell-nav-toggle")).toBeVisible();
  await assertNothingMoved(page, { targets, clicked: "newBuild", point });
});

test("a late session that grants none of the console's destinations leaves the page without navigation, where it showed", {
  skip: SKIP,
  timeout: 90_000
}, async (t) => {
  const targets = ["builds", "title"];
  const { page, release } = await openHeld(t, { viewport: EXPANDED, targets, permissions: [] });

  await release();
  const point = await clickWhereFirstSeen(page, "builds");
  await settle(page);

  await expect(page.getByTestId("jskit-shell-drawer")).toHaveCount(0);
  await expect(page.getByTestId("jskit-shell-nav-toggle")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Machines" })).toHaveCount(0);
  await assertNothingMoved(page, { targets, clicked: "builds", point });
});

test("the shell's typeface is asked for before the shell mounts, so it is usually in by the time the shell shows", {
  skip: SKIP,
  timeout: 90_000
}, async (t) => {
  const { vite, browser } = await open(t);
  const page = await browser.newPage({ baseURL: vite.baseURL, viewport: EXPANDED });
  const fontRequests = [];
  page.on("request", (request) => {
    if (/roboto-flex-[^/]*\.woff2/u.test(request.url())) {
      fontRequests.push(request);
    }
  });
  await page.goto("/home");
  await expect(page.getByTestId("jskit-shell-drawer")).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => true));
  assert.ok(fontRequests.length > 0, "the page never asked for Roboto Flex");
  const askedAt = Math.min(...await Promise.all(fontRequests.map(async (request) => {
    await request.response();
    return request.timing().startTime;
  })));
  const mount = await page.evaluate(() => ({ ...window.__fixtureMount, at: performance.timeOrigin + window.__fixtureMount.at }));
  t.diagnostic(`Roboto Flex first asked for ${Math.round(askedAt - mount.at)} ms from the shell's mount; its faces then: ${mount.robotoFlex.join(", ")}`);

  assert.ok(
    mount.robotoFlex.some((status) => status === "loading" || status === "loaded"),
    `no Roboto Flex face was loading as the shell mounted (${mount.robotoFlex.join(", ")})`
  );
  assert.ok(askedAt < mount.at, `Roboto Flex was first asked for ${Math.round(askedAt - mount.at)} ms after the shell mounted`);
});

test("a page whose navigation is ready as it opens shows its content and title where they stay, its drawer fitted", {
  skip: SKIP,
  timeout: 90_000
}, async (t) => {
  const targets = ["validate", "title"];
  // Roboto Flex is held throughout, so the drawer's fit is what the case checks, whenever the font would come.
  const { page, releaseFonts } = await openHome(t, { fonts: "held", targets });
  try {
    const point = await clickWhereFirstSeen(page, "validate");
    await settle(page);

    await assertNothingMoved(page, { targets, clicked: "validate", point });
  } finally {
    releaseFonts();
  }
});

test("a page whose typeface is slow shows in the fallback font within the shell's short wait for it, and nothing moves while the font is held", {
  skip: SKIP,
  timeout: 90_000
}, async (t) => {
  const targets = ["validate", "title"];
  const { page, fontAskedAt, releaseFonts } = await openHome(t, { fonts: "held", targets });
  try {
    // Seen while the font is still held, well within the 3 s a slow connection takes.
    const point = await clickWhereFirstSeen(page, "validate", { timeout: SLOW_FONT_MS - 1_000 });
    const { first } = await places(page);
    const mountedAt = await page.evaluate(() => window.__fixtureMount.at);
    t.diagnostic(`content first seen ${Math.round(first.validate.at - mountedAt)} ms after the shell mounted, Roboto Flex held`);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, fontAskedAt + SLOW_FONT_MS - Date.now())));
    await settle(page);

    await assertNothingMoved(page, { targets, clicked: "validate", point });
  } finally {
    releaseFonts();
  }
});

test("a page whose typeface fails shows in the fallback font, and nothing moves", {
  skip: SKIP,
  timeout: 90_000
}, async (t) => {
  const targets = ["validate", "title"];
  const { page } = await openHome(t, { fonts: "failed", targets });
  const point = await clickWhereFirstSeen(page, "validate");
  await settle(page);

  await assertNothingMoved(page, { targets, clicked: "validate", point });
});
