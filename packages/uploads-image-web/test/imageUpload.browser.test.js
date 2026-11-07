import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createChromiumLaunchOptions, startViteFixture, stopProcess } from "../../../tooling/testUtils/browserFixture.mjs";

const ALLOWED_TYPES_MESSAGE = "You can only upload: image/jpeg, image/png, image/webp";
// What Uppy's XHR upload hands upload-error for any HTTP error: its own network-error text and the XMLHttpRequest,
// which has no parsed body. It retries three times first.
const UPPY_HTTP_ERROR_MESSAGE = "This looks like a network error, the endpoint might be blocked by an internet provider or a firewall.";
const UPPY_ATTEMPTS_PER_FAILED_UPLOAD = 4;

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// A request the fixture server holds: `arrived` settles when it comes in, `release` lets it answer.
function createGate() {
  return { arrived: createDeferred(), release: createDeferred() };
}

async function arrival(gate, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`No ${label} request arrived.`)), 15_000);
  });
  try {
    await Promise.race([gate.arrived.promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// A real JPEG at full quality, drawn by the browser, so the compressor has something to save.
async function createPhoto(page, { width, height }) {
  const base64 = await page.evaluate(async ({ width: canvasWidth, height: canvasHeight }) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, canvasWidth, canvasHeight);
    gradient.addColorStop(0, "#0b6e4f");
    gradient.addColorStop(1, "#f2a541");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    let seed = 7;
    for (let index = 0; index < 400; index += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      context.fillStyle = `hsl(${seed % 360} 70% 50% / 0.6)`;
      context.beginPath();
      context.arc(seed % canvasWidth, (seed >> 8) % canvasHeight, 4 + (seed % 24), 0, Math.PI * 2);
      context.fill();
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 1));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  }, { width, height });
  return Buffer.from(base64, "base64");
}

function readJpegSize(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, "the uploaded file is a JPEG");
  let offset = 2;
  while (offset + 9 < bytes.length) {
    const marker = bytes[offset + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error("The JPEG has no frame header.");
}

// What reached the server: read while the route holds the request, checked once the page has answered.
async function readUpload(request) {
  const headers = request.headers();
  const body = request.postDataBuffer();
  const upload = { headers, contentType: headers["content-type"] || "", hasBody: Boolean(body), fields: {}, files: [] };
  if (!body) {
    return upload;
  }
  const form = await new Response(body, { headers: { "content-type": upload.contentType } }).formData();
  for (const [field, value] of form.entries()) {
    if (typeof value === "string") {
      upload.fields[field] = value;
    } else {
      upload.files.push({ field, name: value.name, type: value.type, bytes: Buffer.from(await value.arrayBuffer()) });
    }
  }
  return upload;
}

function assertMultipartUpload(upload, { field, name }) {
  assert.ok(upload.hasBody, "the upload request carries its body");
  assert.match(upload.contentType, /^multipart\/form-data; boundary=/u);
  assert.equal(upload.headers["csrf-token"], "fixture-csrf");
  assert.equal(upload.files.length, 1);
  const [file] = upload.files;
  assert.equal(file.field, field);
  assert.equal(file.name, name);
  assert.equal(file.type, "image/jpeg");
  return file;
}

async function openPage(browser, baseURL) {
  const page = await browser.newPage({ baseURL, viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { page, errors };
}

function dashboardOf(page) {
  return page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Close Modal", exact: true }) });
}

function chooseFile(dashboard, file) {
  return dashboard.locator(".uppy-Dashboard-input[type=\"file\"]").first().setInputFiles(file);
}

// The roles and typeface Vuetify's theme sets on :root, for each scheme; the fixture has no Vuetify of its own.
const SCHEMES = Object.freeze({
  light: {
    surface: "236, 230, 240",
    onSurface: "29, 27, 32",
    onSurfaceVariant: "73, 69, 79",
    outlineVariant: "202, 196, 208",
    primary: "103, 80, 164",
    font: "\"Fixture Sans\", sans-serif"
  },
  dark: {
    surface: "43, 41, 48",
    onSurface: "230, 225, 229",
    onSurfaceVariant: "202, 196, 208",
    outlineVariant: "73, 69, 79",
    primary: "208, 188, 255",
    font: "\"Fixture Sans\", sans-serif"
  }
});

function schemeCss({ surface, onSurface, onSurfaceVariant, outlineVariant, primary, font }) {
  return `:root { --v-theme-surface-container-high: ${surface}; --v-theme-on-surface: ${onSurface}; ` +
    `--v-theme-primary: ${primary}; --v-theme-on-primary: 255, 255, 255; --v-theme-outline-variant: ${outlineVariant}; ` +
    `--v-theme-on-surface-variant: ${onSurfaceVariant}; --v-theme-scrim: 0, 0, 0; --v-font-body: ${font}; }`;
}

// Waits for the dialog's open animation and colour transitions to finish.
function settle(page) {
  // Only animations that end: an endless one (a spinner) would never settle.
  return page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity))
    .map((animation) => animation.finished.catch(() => null))));
}

function contrastRatio(foreground, background) {
  const luminance = (rgb) => {
    const [r, g, b] = rgb.match(/\d+(\.\d+)?/gu).slice(0, 3).map((channel) => {
      const value = Number(channel) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

// Where the dialog sits at one viewport: its box, its close button's, what the scrim leaves on top of the app bar.
function readPlacement(dashboard) {
  return dashboard.evaluate((inner) => {
    const box = (node) => {
      const { top, right, bottom, left } = node.getBoundingClientRect();
      return { top: Math.round(top), right: Math.round(right), bottom: Math.round(bottom), left: Math.round(left) };
    };
    const close = inner.querySelector(".uppy-Dashboard-close");
    const onAppBar = document.elementFromPoint(window.innerWidth - 2, 32);
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      inner: box(inner),
      radius: window.getComputedStyle(inner).borderTopLeftRadius,
      close: box(close),
      appBarCovered: !onAppBar.closest("[data-testid=fixture-app-bar]")
    };
  });
}

function assertPlacement(placement, { fullScreen }) {
  const { viewport, inner, close } = placement;
  assert.equal(placement.appBarCovered, true, `the scrim covers the app bar at ${viewport.width}px`);
  assert.ok(inner.top >= 0 && inner.left >= 0 && inner.right <= viewport.width && inner.bottom <= viewport.height,
    `the dialog fits the viewport at ${viewport.width}px: ${JSON.stringify(placement)}`);
  assert.ok(close.top >= inner.top && close.left >= inner.left && close.right <= inner.right && close.bottom <= inner.bottom,
    `the close button lies inside the dialog at ${viewport.width}px: ${JSON.stringify(placement)}`);
  if (fullScreen) {
    assert.deepEqual({ inner, radius: placement.radius },
      { inner: { top: 0, right: viewport.width, bottom: viewport.height, left: 0 }, radius: "0px" });
  } else {
    assert.equal(placement.radius, "28px");
  }
}

// The dialog takes the app's Material 3 roles and typeface in both schemes, instead of Uppy's light grey panel, blue
// underlined link, low-contrast hint and system font. It is modal over the whole app: the scrim covers a top app bar,
// the close button lies inside the dialog, and at compact width it is a full-screen dialog.
async function checkMaterialRoles(page) {
  await page.route("**/api/**", (route) => route.fulfill({ json: { csrfToken: "fixture-csrf" } }));
  await page.goto("/avatar");
  const scheme = await page.addStyleTag({ content: schemeCss(SCHEMES.light) });
  // Where Vuetify draws its app bar: fixed at the top, z-index 1004, with the page's content below it as v-main puts it.
  await page.evaluate(() => {
    const bar = document.createElement("header");
    bar.dataset.testid = "fixture-app-bar";
    bar.style.cssText = "position: fixed; top: 0; right: 0; left: 0; height: 64px; z-index: 1004; background: #888;";
    document.body.style.paddingTop = "64px";
    document.body.append(bar);
  });
  await page.getByRole("button", { name: "Change avatar", exact: true }).click();
  const dashboard = dashboardOf(page);
  await expect(dashboard).toBeVisible();
  const read = () => dashboard.evaluate((inner) => {
    const root = inner.closest(".uppy-Root");
    const browse = root.querySelector(".uppy-Dashboard-browse");
    const note = root.querySelector(".uppy-Dashboard-note");
    const style = (node) => window.getComputedStyle(node);
    return {
      panel: style(inner).backgroundColor,
      text: style(root).color,
      font: style(browse).fontFamily,
      link: style(browse).color,
      underline: [style(browse).borderBottomStyle, style(browse).textDecorationLine],
      note: style(note).color
    };
  });
  await page.mouse.move(0, 0);
  for (const name of ["light", "dark"]) {
    const { surface, onSurface, onSurfaceVariant, primary, font } = SCHEMES[name];
    await scheme.evaluate((element, css) => { element.textContent = css; }, schemeCss(SCHEMES[name]));
    await settle(page);
    const roles = await read();
    assert.deepEqual({ scheme: name, ...roles }, {
      scheme: name,
      panel: `rgb(${surface})`,
      text: `rgb(${onSurface})`,
      font,
      link: `rgb(${primary})`,
      underline: ["none", "none"],
      note: `rgb(${onSurfaceVariant})`
    });
    const noteContrast = contrastRatio(roles.note, roles.panel);
    assert.ok(noteContrast >= 4.5, `the ${name} hint text has ${noteContrast.toFixed(2)}:1 contrast`);
  }

  for (const [width, height, fullScreen] of [[1280, 900, false], [768, 1024, false], [390, 844, true]]) {
    await page.setViewportSize({ width, height });
    await settle(page);
    assertPlacement(await readPlacement(dashboard), { fullScreen });
  }
  await dashboard.getByRole("button", { name: "Close Modal", exact: true }).click();
  await expect(dashboard).toHaveCount(0);
}

async function checkManagedAvatar(page) {
  const uploads = [];
  const deletes = [];
  const unexpected = [];
  let uploadReply = { status: 200, json: { profile: { avatar: { version: 2 } } } };
  let deleteReply = null;
  let deleteGate = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/session") {
      await route.fulfill({ json: { csrfToken: "fixture-csrf" } });
    } else if (request.method() === "POST" && path === "/api/settings/profile/avatar") {
      uploads.push(await readUpload(request));
      await route.fulfill(uploadReply);
    } else if (request.method() === "DELETE" && path === "/api/settings/profile/avatar") {
      deletes.push({ csrfToken: request.headers()["csrf-token"] });
      const gate = deleteGate;
      if (gate) {
        gate.arrived.resolve();
        await gate.release.promise;
      }
      await route.fulfill(deleteReply);
    } else {
      unexpected.push(`${request.method()} ${path}`);
      await route.fulfill({ status: 404, json: {} });
    }
  });
  const dashboard = dashboardOf(page);
  const feedback = page.locator(".fixture-feedback li");
  const asset = page.locator(".fixture-asset");
  const selected = page.locator(".fixture-selected");

  await page.goto("/avatar");
  await expect(asset).toHaveText("Asset: /api/settings/profile/avatar?v=1");
  const photo = await createPhoto(page, { width: 320, height: 240 });

  // A file of the wrong type is refused before anything is sent.
  await page.getByRole("button", { name: "Change avatar", exact: true }).click();
  await expect(dashboard).toBeVisible();
  await chooseFile(dashboard, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await expect(feedback).toHaveText([`error banner: ${ALLOWED_TYPES_MESSAGE}`]);
  await expect(selected).toHaveText("Selected: nothing");
  await dashboard.getByRole("button", { name: "Close Modal", exact: true }).click();
  await expect(dashboard).toHaveCount(0);

  // Choose a photo, crop it square in the image editor, upload it.
  await page.getByRole("button", { name: "Change avatar", exact: true }).click();
  await expect(dashboard).toBeVisible();
  await chooseFile(dashboard, { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(selected).toHaveText("Selected: photo.jpg");
  await dashboard.getByRole("button", { name: "Edit file photo.jpg", exact: true }).click();
  await expect(dashboard.locator(".cropper-crop-box")).toBeVisible();
  await dashboard.getByRole("button", { name: "Crop square", exact: true }).click();
  await dashboard.locator(".uppy-DashboardContent-save").click();
  await expect(dashboard.locator(".cropper-crop-box")).toHaveCount(0);
  await dashboard.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  await expect(dashboard).toHaveCount(0);
  await expect(asset).toHaveText("Asset: /api/settings/profile/avatar?v=2");
  await expect(selected).toHaveText("Selected: nothing");
  await expect(feedback).toHaveText([`error banner: ${ALLOWED_TYPES_MESSAGE}`, "success snackbar: Avatar uploaded."]);
  assert.equal(uploads.length, 1);
  const uploaded = assertMultipartUpload(uploads[0], { field: "avatar", name: "photo.jpg" });
  const size = readJpegSize(uploaded.bytes);
  assert.equal(size.width, size.height, `the editor's square crop is what was sent, got ${size.width}x${size.height}`);
  assert.ok(size.width <= 240, `the crop fits the 320x240 photo, got ${size.width}`);

  // A server error is reported and leaves the avatar as it was.
  uploadReply = { status: 422, json: { error: "Avatar is too small.", fieldErrors: { avatar: "Use an image of at least 64 pixels." } } };
  await page.getByRole("button", { name: "Change avatar", exact: true }).click();
  await expect(dashboard).toBeVisible();
  await chooseFile(dashboard, { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo });
  await dashboard.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  await expect(feedback.last()).toHaveText(`error banner: ${UPPY_HTTP_ERROR_MESSAGE}`);
  assert.equal(uploads.length, 1 + UPPY_ATTEMPTS_PER_FAILED_UPLOAD);
  await expect(asset).toHaveText("Asset: /api/settings/profile/avatar?v=2");
  await dashboard.getByRole("button", { name: "Close Modal", exact: true }).click();
  await expect(dashboard).toHaveCount(0);

  // Removing: busy while the server answers; a refusal keeps the avatar, a success clears it.
  const remove = page.getByRole("button", { name: "Remove avatar", exact: true });
  deleteReply = { status: 500, json: { error: "Avatar is locked." } };
  deleteGate = createGate();
  await remove.click();
  await arrival(deleteGate, "delete");
  await expect(page.getByRole("button", { name: "Removing…", exact: true })).toBeDisabled();
  deleteGate.release.resolve();
  deleteGate = null;
  await expect(feedback.last()).toHaveText("error banner: Avatar is locked.");
  await expect(asset).toHaveText("Asset: /api/settings/profile/avatar?v=2");
  await expect(remove).toBeEnabled();
  deleteReply = { status: 200, json: { profile: { avatar: null } } };
  await remove.click();
  await expect(feedback.last()).toHaveText("success snackbar: Image removed.");
  await expect(asset).toHaveText("Asset: none");
  await expect(remove).toBeDisabled();

  assert.deepEqual(deletes, [{ csrfToken: "fixture-csrf" }, { csrfToken: "fixture-csrf" }]);
  assert.deepEqual(unexpected, []);
}

async function checkUploadRuntime(page) {
  const uploads = [];
  const unexpected = [];
  let uploadReply = { status: 200, json: { id: "signature-1" } };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/session") {
      await route.fulfill({ json: { csrfToken: "fixture-csrf" } });
    } else if (request.method() === "POST" && path === "/api/signature") {
      uploads.push(await readUpload(request));
      await route.fulfill(uploadReply);
    } else {
      unexpected.push(`${request.method()} ${path}`);
      await route.fulfill({ status: 404, json: {} });
    }
  });
  const dashboard = dashboardOf(page);
  const events = page.locator(".fixture-events li");

  await page.goto("/signature");
  const photo = await createPhoto(page, { width: 640, height: 480 });
  await page.getByRole("button", { name: "Upload signature", exact: true }).click();
  await expect(dashboard).toBeVisible();
  await expect(dashboard).toContainText("Accepted: image/jpeg, image/png, image/webp, max 5MB");

  // The default restrictions: images only, at most 5 MB.
  await chooseFile(dashboard, { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") });
  await expect(events).toHaveText([`restriction notes.txt: ${ALLOWED_TYPES_MESSAGE}`]);
  await chooseFile(dashboard, { name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(events.last()).toHaveText("restriction huge.png: huge.png exceeds maximum allowed size of 5 MB");
  assert.equal(uploads.length, 0);

  // A photo goes up compressed, with the resolved headers.
  await chooseFile(dashboard, { name: "photo.jpg", mimeType: "image/jpeg", buffer: photo });
  await dashboard.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  await expect(events.last()).toHaveText("success photo.jpg: {\"id\":\"signature-1\"}");
  assert.equal(uploads.length, 1);
  const uploaded = assertMultipartUpload(uploads[0], { field: "file", name: "photo.jpg" });
  assert.equal(Object.hasOwn(uploads[0].headers, "x-fixture-unset"), false, "a header resolved to null is not sent");
  assert.ok(uploaded.bytes.length < photo.length, `the compressor shrank ${photo.length} bytes, sent ${uploaded.bytes.length}`);
  assert.deepEqual(readJpegSize(uploaded.bytes), { width: 640, height: 480 });

  // After a success the dashboard is empty again; a server error reaches the error callback.
  uploadReply = { status: 500, json: { error: "Signature storage is unavailable." } };
  await expect(dashboard.locator(".uppy-Dashboard-AddFiles")).toBeVisible();
  await chooseFile(dashboard, { name: "second.jpg", mimeType: "image/jpeg", buffer: photo });
  await dashboard.getByRole("button", { name: "Upload 1 file", exact: true }).click();
  await expect(events.last()).toHaveText(`error second.jpg 500: ${UPPY_HTTP_ERROR_MESSAGE}`);
  assert.equal(uploads.length, 1 + UPPY_ATTEMPTS_PER_FAILED_UPLOAD);
  assert.equal(await events.count(), 4);
  assert.deepEqual(unexpected, []);
}

test("Image uploads run on real Uppy in a real browser", {
  skip: process.env.JSKIT_UPLOADS_IMAGE_WEB_BROWSER !== "1",
  timeout: 240_000
}, async (t) => {
  // Stopped in after hooks, which run when a check fails or times out too (a body's `finally` doesn't after a timeout).
  const runtime = await startViteFixture({ fixtureRoot: fileURLToPath(new URL("../fixtures/image-upload/", import.meta.url)) });
  t.after(() => stopProcess(runtime));
  const browser = await chromium.launch(createChromiumLaunchOptions());
  t.after(() => browser.close());
  for (const [name, check] of [
    ["the managed avatar runtime refuses, edits, uploads, reports a server error and deletes", checkManagedAvatar],
    ["the dialog takes the app's Material 3 roles and typeface in light and dark", checkMaterialRoles],
    ["the upload runtime given only its four required callbacks refuses, uploads compressed and reports a server error", checkUploadRuntime]
  ]) {
    await t.test(name, async () => {
      const { page, errors } = await openPage(browser, runtime.baseURL);
      try {
        await check(page);
        assert.deepEqual(errors, []);
      } catch (error) {
        console.error(await page.locator("body").innerText().catch(() => ""));
        throw error;
      } finally {
        await page.close();
      }
    });
  }
});
