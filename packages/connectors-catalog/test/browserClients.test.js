import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleAnalytics } from "../src/client/google-analytics.js";
import { mountGoogleMap } from "../src/client/google-maps-platform.js";

function createMapElement() {
  return {
    clears: 0,
    replaceChildren() {
      this.clears += 1;
    }
  };
}

function createMapsSdk() {
  const imported = [];
  const released = [];
  class Map {
    constructor(element, options) {
      this.element = element;
      this.options = options;
    }
  }
  return {
    imported,
    released,
    async importLibrary(name) {
      imported.push(name);
      return { Map };
    },
    event: {
      clearInstanceListeners(target) {
        released.push(target);
      }
    }
  };
}

function createAnalyticsPage() {
  const scripts = [];
  return {
    scripts,
    location: { href: "https://example.test/start" },
    document: {
      title: "Start",
      querySelector: () => null,
      createElement: () => ({}),
      head: {
        appendChild(script) {
          scripts.push(script);
        }
      }
    }
  };
}

const center = { lat: -31.95, lng: 115.86 };

test("a map mounts and disposes once without an abort signal", async () => {
  const element = createMapElement();
  const maps = createMapsSdk();

  const mounted = await mountGoogleMap({ element, maps, center });
  assert.deepEqual(mounted.map.options, { center, zoom: 12 });
  assert.equal(element.clears, 0);

  mounted.dispose();
  mounted.dispose();
  assert.equal(element.clears, 1);
  assert.deepEqual(maps.released, [mounted.map]);
});

test("a signal aborted before mounting stops it before Google's SDK loads a library", async () => {
  const controller = new AbortController();
  const maps = createMapsSdk();
  controller.abort();

  await assert.rejects(mountGoogleMap({ element: createMapElement(), maps, center, signal: controller.signal }));
  assert.deepEqual(maps.imported, []);
});

test("aborting a mounted map disposes it, and disposing it stops listening to the signal", async () => {
  const aborted = new AbortController();
  const abortedElement = createMapElement();
  await mountGoogleMap({ element: abortedElement, maps: createMapsSdk(), center, signal: aborted.signal });
  aborted.abort();
  assert.equal(abortedElement.clears, 1);

  const disposed = new AbortController();
  const disposedElement = createMapElement();
  const mounted = await mountGoogleMap({ element: disposedElement, maps: createMapsSdk(), center, signal: disposed.signal });
  mounted.dispose();
  disposed.abort();
  assert.equal(disposedElement.clears, 1);
});

test("a page without Google's SDK is told to load it", async () => {
  await assert.rejects(
    mountGoogleMap({ element: createMapElement(), center }),
    /load the Google Maps JavaScript SDK first/u
  );
});

test("a page has one Analytics owner, and nothing loads before consent", () => {
  const page = createAnalyticsPage();
  const analytics = createGoogleAnalytics({ measurementId: "G-FIXTURE1", window: page });

  assert.equal(createGoogleAnalytics({ measurementId: "G-FIXTURE1", window: page }), analytics);
  assert.throws(() => createGoogleAnalytics({ measurementId: "G-OTHER1", window: page }), /already has an Analytics owner/u);
  assert.equal(page.scripts.length, 0);

  analytics.setConsent(true);
  assert.equal(page.scripts.length, 1);
  assert.match(page.scripts[0].src, /googletagmanager\.com\/gtag\/js\?id=G-FIXTURE1/u);
});

test("Analytics refuses an invalid Measurement ID and a page with no document", () => {
  assert.throws(() => createGoogleAnalytics({ measurementId: "UA-1", window: createAnalyticsPage() }), /valid GA4 Measurement ID/u);
  assert.throws(() => createGoogleAnalytics({ measurementId: "G-FIXTURE1", window: {} }), /in the browser after hydration/u);
});
