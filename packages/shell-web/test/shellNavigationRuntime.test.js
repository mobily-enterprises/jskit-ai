import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMemoryHistory, createRouter } from "vue-router";
import { shellScrollBehavior } from "@jskit-ai/kernel/client";
import { createShellNavigationRuntime } from "../src/client/navigation/shellNavigationRuntime.js";

// A window whose history state behaves as the browser's under vue-router: a push starts an entry with fresh state, a
// replacement keeps the entry's state.
function browserLikeRouter(routes) {
  let state = null;
  let position = 0;
  let pushing = false;
  globalThis.window = {
    history: {
      get state() {
        return state;
      },
      replaceState(next) {
        state = next;
      }
    },
    scrollX: 0,
    scrollY: 0,
    setTimeout: () => 0,
    clearTimeout() {}
  };
  const router = createRouter({ history: createMemoryHistory(), routes });
  const push = router.push.bind(router);
  const replace = router.replace.bind(router);
  router.push = (to) => {
    pushing = true;
    return push(to);
  };
  router.replace = (to) => {
    pushing = false;
    return replace(to);
  };
  router.afterEach((_to, _from, failure) => {
    if (!failure && pushing) {
      position += 1;
      state = { position };
    }
  });
  return router;
}

const component = { render: () => null };
const routes = [
  { path: "/home/actions", component, meta: { jskit: { title: "Actions" } } },
  { path: "/home/actions/new", component, meta: { jskit: { parent: "/actions" } } }
];

test("a page title claim gives the previous claim's title back when it is released", () => {
  const runtime = createShellNavigationRuntime({ router: createRouter({ history: createMemoryHistory(), routes }) });
  const page = () => "Page";
  const panel = () => "Panel";
  assert.equal(runtime.pageTitleSource.value, null);
  const releasePage = runtime.setPageTitle(page);
  const releasePanel = runtime.setPageTitle(panel);
  assert.equal(runtime.pageTitleSource.value, panel);
  releasePanel();
  assert.equal(runtime.pageTitleSource.value, page, "the page's title comes back");
  releasePanel();
  assert.equal(runtime.pageTitleSource.value, page, "a second release changes nothing");

  // Released out of order: the remaining claim stays on top.
  const releaseOther = runtime.setPageTitle(panel);
  releasePage();
  assert.equal(runtime.pageTitleSource.value, panel);
  releaseOther();
  assert.equal(runtime.pageTitleSource.value, null, "with no claim left, the route's title shows");
});

test("a page close claim turns the Up arrow into the page's close until it is released", async () => {
  const runtime = createShellNavigationRuntime({ router: createRouter({ history: createMemoryHistory(), routes }) });
  const closes = [];
  assert.equal(runtime.pageClose.value, null);
  const form = { label: () => "Cancel", close: () => closes.push("form") };
  const release = runtime.setPageClose(form);
  assert.equal(runtime.pageClose.value, form);
  const dialog = { label: () => "Close", close: () => closes.push("dialog") };
  const releaseDialog = runtime.setPageClose(dialog);
  assert.equal(runtime.pageClose.value, dialog);
  releaseDialog();
  assert.equal(runtime.pageClose.value, form, "the form's close comes back");
  release();
  assert.equal(runtime.pageClose.value, null, "with no claim left, the arrow goes Up again");

  const source = await readFile(new URL("../src/client/components/ShellUpButton.vue", import.meta.url), "utf8");
  assert.match(source, /pageClose\.value \? pageClose\.value\.close\(\) : up\(\)/u);
  assert.match(source, /:icon="pageClose \? '\$close' : '\$arrowBack'"/u);
});

test("finish(target) returns to the trail's entry with its query when the target is the page the form came from", async () => {
  const router = browserLikeRouter(routes);
  const runtime = createShellNavigationRuntime({ router });
  runtime.install();
  runtime.attachShell();
  try {
    await router.push("/home/actions?view=table&page=2");
    await router.push("/home/actions/new");
    assert.deepEqual(runtime.trail.value.map((step) => step.path), ["/home/actions?view=table&page=2"]);
    await runtime.finish("/home/actions", "/home/actions");
    assert.equal(router.currentRoute.value.fullPath, "/home/actions?view=table&page=2");
    assert.deepEqual(runtime.trail.value, []);

    // A target with a query of its own keeps it.
    await router.push("/home/actions/new");
    await runtime.finish("/home/actions?view=cards", "/home/actions");
    assert.equal(router.currentRoute.value.fullPath, "/home/actions?view=cards");

    // Cancel goes back to where the form was opened from, query and all.
    await router.push("/home/actions/new");
    await runtime.finish("", "/home/actions");
    assert.equal(router.currentRoute.value.fullPath, "/home/actions?view=cards");
  } finally {
    runtime.dispose();
    delete globalThis.window;
  }
});

// File routing groups a folder's routes under a record that draws no component, here the whole /w folder. Two pages
// in it are different pages: the next opens at the top, and Up's saved position is used. A layout that hosts tabs
// draws a component, so its tabs stay one page.
test("pages in a route folder are different pages, so a new page opens at the top and Up restores the saved scroll", async () => {
  const folderRoutes = [{
    path: "/w",
    children: [
      { path: "day/overview", component, meta: { jskit: { title: "Daily overview" } } },
      { path: "bookings/:id", component, meta: { jskit: { parent: "/w/day/overview" } } },
      {
        path: "settings",
        component,
        meta: { jskit: { parent: "/w/day/overview" } },
        children: [
          { path: "general", component },
          { path: "profile", component }
        ]
      }
    ]
  }];
  const router = browserLikeRouter(folderRoutes);
  const push = router.push;
  let pushedState = null;
  router.push = (to) => {
    pushedState = typeof to === "object" ? to.state || null : null;
    return push(to);
  };
  const runtime = createShellNavigationRuntime({ router });
  runtime.install();
  runtime.attachShell();
  const scrollFor = (from) => shellScrollBehavior(router.currentRoute.value, from, null);
  try {
    await router.push("/w/day/overview");
    globalThis.window.scrollY = 1313;
    let from = router.currentRoute.value;
    await router.push("/w/bookings/7");
    assert.deepEqual(scrollFor(from), { top: 0 });
    assert.deepEqual(runtime.trail.value, [{ path: "/w/day/overview", scroll: { left: 0, top: 1313 } }]);

    globalThis.window.scrollY = 56;
    from = router.currentRoute.value;
    await runtime.up("/w/day/overview");
    assert.equal(router.currentRoute.value.fullPath, "/w/day/overview");
    assert.deepEqual(pushedState, { restoreScroll: { left: 0, top: 1313 } });
    globalThis.window.history.replaceState({ ...globalThis.window.history.state, ...pushedState }, "");
    assert.deepEqual(scrollFor(from), { left: 0, top: 1313 });

    // Tabs of a settings layout stay one page: the scroll stays, and so does the trail.
    await router.push("/w/settings/general");
    const trail = runtime.trail.value;
    from = router.currentRoute.value;
    await router.push("/w/settings/profile");
    assert.equal(scrollFor(from), false);
    assert.deepEqual(runtime.trail.value, trail);
  } finally {
    runtime.dispose();
    delete globalThis.window;
  }
});

// After Up, the runtime retries focusing the opener of the page left until the page draws it. Those retries end at the
// next navigation and when focus has moved since they were scheduled, so they never take the caret from a field
// someone is typing in (a Back then Forward within the retry window used to focus a matching tab on the next page).
test("Up's opener focus retries stop at the next navigation and when focus has moved", async () => {
  const router = browserLikeRouter(routes);
  const timers = new Map();
  let nextTimer = 1;
  globalThis.window.setTimeout = (callback) => {
    timers.set(nextTimer, callback);
    return nextTimer++;
  };
  globalThis.window.clearTimeout = (id) => {
    timers.delete(id);
  };
  // One round runs the timers due now (one focus attempt); every round runs until none is left.
  const runRound = () => {
    const due = [...timers];
    timers.clear();
    for (const [, callback] of due) {
      callback();
    }
  };
  const runEveryRound = () => {
    for (let round = 0; round < 20 && timers.size > 0; round += 1) {
      runRound();
    }
  };
  const focused = [];
  const element = (name) => ({ name, focus: () => focused.push(name) });
  const body = element("body");
  const upButton = element("up");
  const searchBox = element("search");
  let openerDrawn = false;
  const opener = { ...element("opener"), getClientRects: () => (openerDrawn ? [{}] : []) };
  globalThis.document = {
    body,
    activeElement: body,
    querySelectorAll: () => [opener],
    getElementById: () => element("title")
  };
  const runtime = createShellNavigationRuntime({ router });
  runtime.install();
  runtime.attachShell();
  const openFormAndGoUp = async () => {
    await router.push("/home/actions");
    await router.push("/home/actions/new");
    focused.length = 0;
    openerDrawn = false;
    globalThis.document.activeElement = upButton;
    await runtime.up("/home/actions");
    assert.equal(router.currentRoute.value.fullPath, "/home/actions");
  };
  try {
    // Unchanged: focus still on Up, the page draws its opener on a later attempt, and the opener gets focus.
    await openFormAndGoUp();
    runRound();
    assert.deepEqual(focused, [], "no opener drawn yet");
    openerDrawn = true;
    runRound();
    assert.deepEqual(focused, ["opener"]);

    // A navigation before the opener is drawn cancels the retries.
    await openFormAndGoUp();
    runRound();
    assert.equal(timers.size, 1, "a retry is waiting");
    await router.push("/home/actions/new");
    openerDrawn = true;
    runEveryRound();
    assert.deepEqual(focused, [], "the next page's matching element is not focused");

    // Focus moved to a field since Up: the retries give up instead of taking it.
    await openFormAndGoUp();
    runRound();
    globalThis.document.activeElement = searchBox;
    openerDrawn = true;
    runEveryRound();
    assert.deepEqual(focused, [], "the field keeps focus");

    // Focus that only fell back to the body (the left page's element went away) does not stop it.
    await openFormAndGoUp();
    globalThis.document.activeElement = body;
    openerDrawn = true;
    runRound();
    assert.deepEqual(focused, ["opener"]);
  } finally {
    runtime.dispose();
    delete globalThis.window;
    delete globalThis.document;
  }
});
