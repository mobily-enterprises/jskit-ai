import { readFile } from "node:fs/promises";
import path from "node:path";
import { blankJsComments, lineIndex, splitVue } from "./material3-source.mjs";

// The navigation rules of the JSKIT Material 3 guide (#241). The shell owns Up and the per-tab trail;
// an app declares each inner page's parent and links through JSKIT navigation, nothing more. Plain `jskit check`
// fails on every rule here, for every JSKIT app, and no comment excuses one; `jskit check m3` lists them with the
// visual rules.

const RULES = Object.freeze({
  "nav/history": "forbidden-in-app-code",
  "nav/window-location": "forbidden-in-app-code",
  "nav/raw-link": "forbidden-in-app-code",
  "nav/back-control": "forbidden-in-app-code",
  "nav/missing-parent": "what-an-app-declares",
  "nav/top-level-parent": "what-an-app-declares"
});

const HISTORY_CALL = /(?<![\w$.])(?:(?:window|globalThis)\s*\.\s*)?history\s*\.\s*(?:back|go|forward|pushState|replaceState)\s*\(/gu;
const ROUTER_HISTORY_CALL = /(?<![\w$])(?:[\w$]*router|useRouter\(\s*\))\s*\.\s*(?:back|go|forward)\s*\(/giu;
const LOCATION_WRITE = new RegExp([
  String.raw`\b(?:window|document|globalThis)\s*\.\s*location(?:\s*\.\s*(?:href|pathname|search|hash))?\s*=(?!=)`,
  String.raw`(?<![\w$.])location\s*\.\s*(?:href|pathname)\s*=(?!=)`,
  String.raw`(?<![\w$])(?:(?:window|document|globalThis)\s*\.\s*)?location\s*\.\s*(?:assign|replace)\s*\(`
].join("|"), "gu");
const ROUTER_PATH = /(?<![\w$])(?:[\w$]*router|useRouter\(\s*\))\s*\.\s*(?:push|replace)\s*\(\s*(?:\{\s*path\s*:\s*)?(["'`])(\/[^"'`]*)/giu;
const OBJECT_PATH = /(?<![\w$])(?:to|href)\s*:\s*(["'`])(\/[^"'`]*)/gu;
const BOUND_PATH = /^\s*(?:\{\s*path\s*:\s*)?(["'`])(\/[^"'`]*)/u;
// A back handler or back component: goBack, onBack, handleBackClick, useBackNavigation, PageBackButton, backToList.
const BACK_NAME = String.raw`(?:[A-Za-z][\w$]*Back(?:[A-Z][\w$]*)?|Back[A-Z][\w$]*|back(?:To[A-Z][\w$]*)?)`;
const BACK_IDENTIFIER = new RegExp(String.raw`(?<![\w$])${BACK_NAME}(?![\w$])`, "u");
const BACK_DEFINITION = new RegExp(String.raw`\b(?:function\s*\*?\s*|const\s+|let\s+|var\s+|import\s+)(${BACK_NAME})(?![\w$])|\bimport\s*\{[^}]*?(?<![\w$])(${BACK_NAME})(?![\w$])[^}]*\}`, "gu");
const BACK_TEXT = /^\s*(?:[←‹«]|(?:go\s+)?back\b|return to\b)|\bback to\b/iu;
const BACK_KEY = /\bback(?:To)?\b/iu;
const ARROW_ICON = /arrow[-_]?back|arrow[-_]?left|keyboard[-_]?backspace|keyboard[-_]?return/iu;
const CHEVRON_ICON = /chevron[-_]?left|\$prev\b|navigate[-_]?before/iu;
const CLICKABLE_TAGS = new Set(["v-btn", "router-link", "a", "v-list-item", "v-chip", "v-icon", "v-app-bar-nav-icon"]);
const BREADCRUMB_TAGS = new Set(["v-breadcrumbs", "v-breadcrumbs-item"]);
const LABEL_ATTRIBUTES = new Set(["aria-label", "title", "label", "text"]);
const ICON_ATTRIBUTES = new Set(["icon", "prepend-icon", "append-icon"]);
const LINK_ATTRIBUTES = new Set(["to", "href"]);
const NAVIGATES = /(?<![\w$])(?:[\w$]*router|useRouter\(\s*\))\s*\.\s*(?:push|replace)\s*\(|\.page\s*\(|resolve\w*Url\s*\(/iu;
// Main navigation: the navigation bar, rail and drawer render shell.primary-nav and shell.secondary-nav links.
const MAIN_NAV_TARGET = /\btarget\s*:\s*["']shell\.(?:primary|secondary)-nav["']/gu;
// A layout that imports the app's ShellLayout wrapper or shell-web's ShellLayout renders the top app bar.
const SHELL_LAYOUT_IMPORT = /\bfrom\s*["'](?:@\/components\/ShellLayout|@jskit-ai\/shell-web\/client\/components\/ShellLayout)(?:\.vue)?["']/u;
const ROUTER_VIEW_TAG = /<\s*(?:RouterView|router-view)\b/u;

function isInAppPath(value) {
  const target = String(value || "").trim();
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/api/")) return false;
  const pathname = target.split(/[?#]/u)[0];
  // A file the server serves (/favicon.svg, /exports/report.pdf) is not an app page.
  return !/\.[a-z0-9]{1,5}$/iu.test(pathname.split("/").pop() || "");
}

const compact = (text) => text.replace(/\s+/gu, "");
const RAW_LINK_FIX = "Resolve it through JSKIT navigation: usePaths().page(), the CRUD runtime's resolve helpers or a shell link item.";

// History, location and hand-built paths in any JavaScript: a script block, a module, or an attribute's expression.
function checkNavigationCode(code, offset, report) {
  for (const pattern of [HISTORY_CALL, ROUTER_HISTORY_CALL]) {
    for (const match of code.matchAll(pattern)) {
      report("nav/history", offset + match.index, `${compact(match[0])}...) navigates by browser history. The shell's Up arrow and the browser's own Back do that; an app never does.`);
    }
  }
  for (const match of code.matchAll(LOCATION_WRITE)) {
    report("nav/window-location", offset + match.index, `${compact(match[0])} navigates outside the router. Reach in-app pages through JSKIT navigation; for a full reload into one (after sign-in or a user switch) use reloadAppPage(path), and to leave the app leaveApp(url), from @jskit-ai/shell-web/client/navigation/documentNavigation.`);
  }
  for (const pattern of [ROUTER_PATH, OBJECT_PATH]) {
    for (const match of code.matchAll(pattern)) {
      if (!isInAppPath(match[2]) || (pattern === OBJECT_PATH && isPlacementLink(code, match.index))) continue;
      report("nav/raw-link", offset + match.index, `Hand-built in-app path "${match[2]}". ${RAW_LINK_FIX}`);
    }
  }
}

// A placement's link props (to, scopedSuffix, unscopedSuffix) are JSKIT navigation input: shell-web resolves them
// with resolveMenuLinkTarget() and renders router links, so `props: { to: "/auth/login" }` is not a hand-built link.
function isPlacementLink(code, offset) {
  const props = enclosingObject(code, offset);
  if (!props) return false;
  const placement = /\bprops\s*:\s*$/u.test(code.slice(0, props.start)) ? enclosingObject(code, props.start - 1) : props;
  return Boolean(placement) && /\btarget\s*:\s*["'`][\w.-]+["'`]/u.test(placement.text) && /\bkind\s*:/u.test(placement.text);
}

function checkScriptBackNames(code, offset, report) {
  for (const match of code.matchAll(BACK_DEFINITION)) {
    const name = match[1] || match[2];
    report("nav/back-control", offset + match.index, `${name} is back logic in the app. Up belongs to the shell; delete it and declare the page's parent.`);
  }
}

function attribute(tag, name) {
  return tag.attributes.find((entry) => entry.name === name);
}

function visibleText(inner) {
  return inner.replace(/<[^>]*>/gu, " ").replace(/\{\{[\s\S]*?\}\}/gu, " ").replace(/\s+/gu, " ").trim();
}

function isBackTag(tag) {
  const segments = tag.name.split("-");
  return segments.includes("back") && !tag.name.startsWith("v-");
}

function looksLikeBack(tag) {
  const mustaches = [...tag.inner.matchAll(/\{\{([\s\S]*?)\}\}/gu)].map((match) => match[1]);
  const labels = tag.attributes.filter((entry) => LABEL_ATTRIBUTES.has(entry.name));
  const icons = tag.attributes.filter((entry) => ICON_ATTRIBUTES.has(entry.name)).map((entry) => entry.value);
  const navigates = tag.attributes.some((entry) => LINK_ATTRIBUTES.has(entry.name) || (entry.event && NAVIGATES.test(entry.value)));
  const iconText = [...icons, tag.inner].join(" ");
  return BACK_TEXT.test(visibleText(tag.inner)) ||
    mustaches.some((expression) => BACK_KEY.test(expression)) ||
    labels.some((entry) => (entry.bound ? BACK_KEY : BACK_TEXT).test(entry.value)) ||
    ARROW_ICON.test(iconText) ||
    (navigates && CHEVRON_ICON.test(iconText));
}

// Every back control but the shell's Up arrow: "Back to X", arrows and navigating chevrons, breadcrumbs, back
// components and back handlers.
function checkBackControl(tag, report) {
  if (BREADCRUMB_TAGS.has(tag.name)) {
    report("nav/back-control", tag.offset, "Breadcrumbs navigate back up the hierarchy. The shell's Up arrow does that; the app bar title says where the person is.");
    return;
  }
  if (isBackTag(tag)) {
    report("nav/back-control", tag.offset, `<${tag.name}> is a back control. Up belongs to the shell; remove it and declare the page's parent.`);
    return;
  }
  const handler = tag.attributes.find((entry) => entry.event && BACK_IDENTIFIER.test(entry.value));
  if (handler) {
    report("nav/back-control", handler.offset, `${handler.raw}="${handler.value.trim()}" is a back handler. Up belongs to the shell; remove the control and declare the page's parent.`);
    return;
  }
  if (CLICKABLE_TAGS.has(tag.name) && looksLikeBack(tag)) {
    report("nav/back-control", tag.offset, "A back control in the page. Up appears once, in the top app bar, from the trail or the declared parent; remove this one.");
  }
}

function checkLinkAttribute(tag, entry, report) {
  if (!LINK_ATTRIBUTES.has(entry.name) || attribute(tag, "download")) return;
  const value = entry.bound ? BOUND_PATH.exec(entry.value)?.[2] : entry.value;
  if (value !== undefined && isInAppPath(value)) {
    report("nav/raw-link", entry.valueOffset, `Hand-built in-app path "${value.trim()}". ${RAW_LINK_FIX}`);
  }
}

// The value of the first balanced { ... } or [ ... ] starting at or after `start`.
function balancedFrom(text, start, open = "{", close = "}") {
  const first = text.indexOf(open, start);
  if (first < 0) return null;
  let depth = 0;
  for (let index = first; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    else if (text[index] === close && --depth === 0) return { start: first, end: index + 1, text: text.slice(first, index + 1) };
  }
  return null;
}

// The object literal that encloses `offset`, as { start, end, text }, or null.
function enclosingObject(text, offset) {
  let depth = 0;
  for (let index = offset; index >= 0; index -= 1) {
    if (text[index] === "}") depth += 1;
    else if (text[index] === "{") {
      if (depth === 0) return balancedFrom(text, index);
      depth -= 1;
    }
  }
  return null;
}

const stringValue = (text, key) => new RegExp(`\\b${key}\\s*:\\s*(["'\\u0060])([^"'\\u0060]*)\\1`, "u").exec(text)?.[2];

// Main-navigation destinations, by surface: every main-navigation placement's suffixes.
function readMainNavigation(sources) {
  const destinations = [];
  for (const source of sources) {
    for (const match of source.matchAll(MAIN_NAV_TARGET)) {
      const placement = enclosingObject(source, match.index)?.text || "";
      const surfaces = [stringValue(placement, "surface"), ...(/\bsurfaces\s*:\s*\[([^\]]*)\]/u.exec(placement)?.[1] || "")
        .split(",").map((entry) => entry.trim().replace(/^["'`]|["'`]$/gu, ""))].filter(Boolean);
      for (const key of ["scopedSuffix", "unscopedSuffix"]) {
        const suffix = stringValue(placement, key);
        if (suffix !== undefined) destinations.push({ suffix: normalisePath(suffix.split(/[?#]/u)[0]), surfaces });
      }
    }
  }
  return destinations;
}

function normalisePath(value) {
  const trimmed = `/${String(value || "").replace(/^\/+|\/+$/gu, "")}`;
  return trimmed === "/" ? "/" : trimmed;
}

// unplugin-vue-router file routes: src/pages/home/suppliers/[supplierId]/edit.vue is home/suppliers/:supplierId/edit,
// and an index file or folder adds no segment.
function routeOf(file) {
  return pageKey(file).split("/").filter((segment) => segment !== "index").join("/");
}

function routePattern(route) {
  return route.replace(/\[\.\.\.([^\]]+)\]/gu, ":$1*").replace(/\[([^\]]+)\]/gu, ":$1");
}

// Each surface's pages root, from config/public.js (config.surfaceDefinitions.<id> = { pagesRoot: "..." }).
function readSurfaces(configSource, pageRoutes) {
  const surfaces = [];
  for (const match of configSource.matchAll(/surfaceDefinitions\s*\.\s*([\w$]+)\s*=\s*\{/gu)) {
    const body = balancedFrom(configSource, match.index + match[0].length - 1)?.text || "";
    const pagesRoot = stringValue(body, "pagesRoot");
    surfaces.push({ id: match[1], pagesRoot: pagesRoot === undefined ? match[1] : pagesRoot.replace(/^\/+|\/+$/gu, "") });
  }
  if (surfaces.length > 0) return surfaces.sort((left, right) => right.pagesRoot.length - left.pagesRoot.length);
  const roots = new Set(pageRoutes.map((route) => route.split("/")[0]).filter(Boolean));
  return [...roots].map((root) => ({ id: root, pagesRoot: root }));
}

function surfaceOf(route, surfaces) {
  return surfaces.find(({ pagesRoot }) => pagesRoot === "" || route === pagesRoot || route.startsWith(`${pagesRoot}/`));
}

// The route block's JSON and the definePage() argument, where a page declares its route meta.
function routeDeclarations(source) {
  const declarations = [];
  const routeBlock = /<route(?:\s[^>]*)?>([\s\S]*?)<\/route\s*>/iu.exec(source);
  if (routeBlock) declarations.push({ text: routeBlock[1], offset: routeBlock.index + routeBlock[0].indexOf(">") + 1 });
  const { scripts } = splitVue(source);
  for (const block of scripts) {
    const code = blankJsComments(block.text);
    const call = /\bdefinePage\s*\(/u.exec(code);
    const argument = call ? balancedFrom(code, call.index + call[0].length) : null;
    if (argument) declarations.push({ text: argument.text, offset: block.offset + argument.start });
  }
  return declarations;
}

const PARENT_KEY = /(?:\bparent|"parent")\s*:/u;
const REDIRECT_KEY = /(?:\bredirect|"redirect")\s*:/u;
// The surface root record carries meta.jskit.surface; a cross-surface parent ({ surface, path }) does not count.
const SURFACE_KEY = /(?:\bsurface|"surface")\s*:/u;
const PARENT_OBJECT = /(?:\bparent|"parent")\s*:\s*\{[^}]*\}/gu;

function readPage(file, source) {
  const declarations = routeDeclarations(source);
  const meta = declarations.map(({ text }) => text).join("\n");
  return {
    file,
    source,
    declarations,
    layout: ROUTER_VIEW_TAG.test(splitVue(source).template?.text || ""),
    redirect: REDIRECT_KEY.test(meta),
    parent: declarations.find(({ text }) => PARENT_KEY.test(text)),
    surfaceRoot: SURFACE_KEY.test(meta.replace(PARENT_OBJECT, "")),
    shell: SHELL_LAYOUT_IMPORT.test(source)
  };
}

/**
 * The page rules: an inner page of a shell surface has a parent, its own or its layout's; a main-navigation
 * destination declares none.
 * @param {{ root: string, appFiles: string[], pageFiles: string[], report: Function }} options appFiles are the whole
 * app's source files (for surfaces, layouts and main navigation); pageFiles are the pages to judge
 */
async function checkPageParents({ root, appFiles, pageFiles, report }) {
  const read = async (file) => readFile(path.join(root, file), "utf8");
  let configSource = "";
  try {
    configSource = blankJsComments(await readFile(path.join(root, "config", "public.js"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const pages = new Map();
  for (const file of appFiles.filter(isPageFile)) pages.set(pageKey(file), readPage(file, await read(file)));
  const surfaces = readSurfaces(configSource, [...pages.values()].map(({ file }) => routeOf(file)));
  const scripts = appFiles.filter((file) => /\.(?:[cm]?[jt]s|vue)$/u.test(file));
  const navigation = readMainNavigation(await Promise.all(scripts.map(async (file) => blankJsComments(await read(file)))));
  const surfacePath = (file, surface) => normalisePath(routePattern(routeOf(file).slice(surface.pagesRoot.length)));
  const isDestination = (relative, surface) => navigation.some(({ suffix, surfaces: owners }) =>
    suffix === relative && (owners.length === 0 || owners.includes(surface.id) || owners.includes("*")));
  const judged = [];
  for (const file of pageFiles.filter(isPageFile)) {
    const page = pages.get(pageKey(file));
    const surface = surfaceOf(routeOf(file), surfaces);
    if (!surface || page.redirect) continue;
    // The layouts that render this page, nearest first: src/pages/home/settings.vue renders home/settings/*.
    const segments = pageKey(file).split("/");
    const layouts = segments.slice(1).map((_, index) => pages.get(segments.slice(0, segments.length - 1 - index).join("/")))
      .filter((entry) => entry?.layout);
    // Up lives in the shell's top app bar, so only pages a shell layout renders have one.
    if (!layouts.some((entry) => entry.shell)) continue;
    const relative = surfacePath(file, surface);
    const destination = isDestination(relative, surface);
    const position = lineIndex(page.source);
    if (destination && page.parent) {
      const at = position(page.parent.offset + PARENT_KEY.exec(page.parent.text).index);
      report({ rule: "nav/top-level-parent", file, ...at, message: `${relative} is a main-navigation destination of ${surface.id}, so it declares no parent: choosing it starts a fresh trail.` });
    }
    if (page.layout) continue;
    // A parent is inherited through the layouts below the surface root; a top-level layout's tabs are top-level.
    const chain = [];
    for (const entry of layouts) {
      if (entry.surfaceRoot) break;
      chain.push(entry);
    }
    const inherited = chain.find((entry) => entry.parent);
    const topLevel = destination || relative === "/" || chain.some((entry) => isDestination(surfacePath(entry.file, surface), surface));
    judged.push({ file, route: relative, surface: surface.id, topLevel, parent: page.parent ? "own" : inherited ? "inherited" : null });
    if (!topLevel && !page.parent && !inherited) {
      const at = position(page.declarations[0]?.offset ?? 0);
      report({ rule: "nav/missing-parent", file, ...at, message: `Inner page ${relative} of ${surface.id} has no parent. Declare it once in the page's route meta (or its layout's, for tabs), so Up works after a direct entry.` });
    }
  }
  return judged;
}

// src/pages/home/suppliers.vue is home/suppliers and src/pages/home/suppliers/index.vue is home/suppliers/index.
function pageKey(file) {
  return file.replace(/^src\/pages\//u, "").replace(/\.vue$/u, "");
}

// A folder or file whose name starts with "_" (such as a CRUD screen's _components) holds components, not pages.
function isPageFile(file) {
  return file.startsWith("src/pages/") && file.endsWith(".vue") && !pageKey(file).split("/").some((segment) => segment.startsWith("_"));
}

export {
  RULES as NAVIGATION_RULES,
  checkBackControl,
  checkLinkAttribute,
  checkNavigationCode,
  checkPageParents,
  checkScriptBackNames,
  isInAppPath,
  isPageFile
};
