const DEFAULT_SMOKE_PATH = String(process.env.JSKIT_PLAYWRIGHT_SMOKE_PATH || "/home");
const DEFAULT_VIEWPORTS = Object.freeze([
  Object.freeze({ name: "compact", width: 390, height: 844 }),
  Object.freeze({ name: "medium", width: 1024, height: 1024 }),
  Object.freeze({ name: "expanded", width: 1280, height: 900 })
]);

async function expectNoHorizontalOverflow(page, expect) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function expectGeneratedScreenContract(page, expect) {
  const screen = page.locator(".generated-ui-screen").first();

  await expect(screen).toBeVisible();
}

async function pullToRefresh(page, expect) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.dispatchEvent("body", "pointerdown", {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 180,
    clientY: 90
  });
  await page.dispatchEvent("body", "pointermove", {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 184,
    clientY: 250
  });
  await expect(page.getByTestId("jskit-shell-pull-refresh")).toBeVisible();
  await page.dispatchEvent("body", "pointerup", {
    pointerId: 41,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: 184,
    clientY: 250
  });
}

async function isElementVisibleInViewport(page, testId) {
  return page.getByTestId(testId).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.left < window.innerWidth &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight
    );
  });
}

async function expectElementVisibility(page, expect, testId, visible) {
  await expect.poll(
    () => isElementVisibleInViewport(page, testId),
    { message: `${testId} did not reach its expected visibility.` }
  ).toBe(visible);
}

async function readShellLayoutClass(drawer) {
  const layoutClass = String(await drawer.getAttribute("data-layout") || "");
  if (!["compact", "medium", "expanded"].includes(layoutClass)) {
    throw new Error(`Shell drawer exposed an invalid data-layout value: ${layoutClass || "(empty)"}.`);
  }
  return layoutClass;
}

async function readConfiguredWidth(drawer, attribute) {
  const width = Number(await drawer.getAttribute(attribute));
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`Shell drawer exposed an invalid ${attribute} value.`);
  }
  return width;
}

async function expectDrawerWidth(drawer, expect, expectedWidth) {
  await expect.poll(async () => {
    const box = await drawer.boundingBox();
    return box ? Math.abs(box.width - expectedWidth) : Number.POSITIVE_INFINITY;
  }, {
    message: `Shell drawer did not settle at ${expectedWidth}px.`
  }).toBeLessThanOrEqual(1);
}

async function expectContentAwareDrawerFit(drawer, expect) {
  if (await drawer.getAttribute("data-drawer-width-mode") !== "content") {
    return;
  }
  const configuredSpacing = Number(await drawer.getAttribute("data-navigation-item-spacing"));
  expect(Number.isFinite(configuredSpacing)).toBe(true);

  const fit = await drawer.evaluate((element) => {
    const drawerRect = element.getBoundingClientRect();
    const drawerStyle = window.getComputedStyle(element);
    const rightToLeft = drawerStyle.direction === "rtl";
    const endBorderWidth = Number.parseFloat(
      rightToLeft ? drawerStyle.borderLeftWidth : drawerStyle.borderRightWidth
    ) || 0;
    const innerEnd = rightToLeft
      ? drawerRect.left + endBorderWidth
      : drawerRect.right - endBorderWidth;
    const labels = Array.from(element.querySelectorAll(".v-list-item-title"))
      .filter((label) => {
        const style = window.getComputedStyle(label);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((label) => {
        const range = document.createRange();
        range.selectNodeContents(label);
        const textRect = range.getBoundingClientRect();
        range.detach?.();
        const icon = label.closest(".v-list-item")?.querySelector(".v-icon");
        const iconRect = icon?.getBoundingClientRect();
        return {
          clipped: (
            label.scrollWidth > label.clientWidth ||
            label.scrollHeight > label.clientHeight ||
            (rightToLeft
              ? textRect.left < innerEnd - 1
              : textRect.right > innerEnd + 1)
          ),
          iconLabelGap: iconRect
            ? rightToLeft ? iconRect.left - textRect.right : textRect.left - iconRect.right
            : null,
          logicalEnd: rightToLeft ? textRect.left : textRect.right,
          width: textRect.width
        };
      })
      .filter((label) => label.width > 0);

    if (labels.length === 0) {
      return null;
    }
    const furthestLabel = labels.reduce((furthest, label) => {
      if (!furthest) {
        return label;
      }
      return rightToLeft
        ? label.logicalEnd < furthest.logicalEnd ? label : furthest
        : label.logicalEnd > furthest.logicalEnd ? label : furthest;
    }, null);
    return {
      clipped: labels.some((label) => label.clipped),
      endGap: rightToLeft
        ? furthestLabel.logicalEnd - innerEnd
        : innerEnd - furthestLabel.logicalEnd,
      iconLabelGaps: labels
        .map((label) => label.iconLabelGap)
        .filter((gap) => Number.isFinite(gap))
    };
  });

  expect(fit).not.toBeNull();
  expect(fit.clipped).toBe(false);
  expect(Math.abs(fit.endGap - configuredSpacing)).toBeLessThanOrEqual(1.1);
  expect(fit.iconLabelGaps.length).toBeGreaterThan(0);
  for (const gap of fit.iconLabelGaps) {
    expect(Math.abs(gap - configuredSpacing)).toBeLessThanOrEqual(1);
  }
}

async function readNavigationIconCenters(drawer) {
  const icons = drawer.locator("a.shell-menu-link-item[href] .v-icon");
  await icons.first().waitFor({ state: "visible" });
  const centers = [];
  const iconCount = await icons.count();
  for (let index = 0; index < iconCount; index += 1) {
    const box = await icons.nth(index).boundingBox();
    if (!box) {
      throw new Error("Shell navigation exposed an unmeasurable icon.");
    }
    centers.push(box.x + box.width / 2);
  }
  return centers;
}

function isRequestedOrDescendantLocation(actualUrl, targetUrl) {
  const normalizePathname = (value) => {
    const pathname = String(value || "/");
    return pathname === "/" ? pathname : pathname.replace(/\/+$/u, "");
  };
  const actualPathname = normalizePathname(actualUrl.pathname);
  const targetPathname = normalizePathname(targetUrl.pathname);
  const pathMatches = actualPathname === targetPathname || (
    targetPathname !== "/" && actualPathname.startsWith(`${targetPathname}/`)
  );

  return pathMatches && actualUrl.search === targetUrl.search;
}

async function expectCentredRailNavigation(page, drawer, expect, expandedIconCenters) {
  const links = drawer.locator("a.shell-menu-link-item[href]");
  await expect(links.first()).toBeVisible();
  const firstLink = links.first();
  const geometry = await Promise.all([drawer.boundingBox(), firstLink.boundingBox()]);
  const [drawerBox, linkBox] = geometry;

  expect(drawerBox).not.toBeNull();
  expect(linkBox).not.toBeNull();
  expect(linkBox.width).toBeGreaterThanOrEqual(48);
  expect(linkBox.height).toBeGreaterThanOrEqual(48);
  const railIconCenters = await readNavigationIconCenters(drawer);
  expect(railIconCenters.length).toBe(expandedIconCenters.length);
  for (let index = 0; index < railIconCenters.length; index += 1) {
    expect(Math.abs(
      railIconCenters[index] - (drawerBox.x + drawerBox.width / 2)
    )).toBeLessThanOrEqual(1);
    expect(Math.abs(
      railIconCenters[index] - expandedIconCenters[index]
    )).toBeLessThanOrEqual(1);
  }

  const currentUrl = new URL(page.url());
  const linkCount = await links.count();
  let navigationLink = null;
  let targetUrl = null;
  for (let index = 0; index < linkCount; index += 1) {
    const candidate = links.nth(index);
    const href = await candidate.getAttribute("href");
    if (!href) {
      continue;
    }
    const resolved = new URL(href, currentUrl);
    if (resolved.pathname !== currentUrl.pathname || resolved.search !== currentUrl.search) {
      navigationLink = candidate;
      targetUrl = resolved;
      break;
    }
  }

  expect(navigationLink).not.toBeNull();
  await navigationLink.locator(".v-icon").first().click();
  await expect.poll(() => {
    const actual = new URL(page.url());
    const leftOriginalLocation = (
      actual.pathname !== currentUrl.pathname ||
      actual.search !== currentUrl.search
    );
    return leftOriginalLocation && isRequestedOrDescendantLocation(actual, targetUrl);
  }, {
    message: "Shell navigation did not reach the requested route or its canonical descendant."
  }).toBe(true);
}

async function openCompactDrawer(page, expect) {
  const drawer = page.getByTestId("jskit-shell-drawer");
  await page.getByTestId("jskit-shell-nav-toggle").click();
  await expect(drawer).toHaveAttribute("data-presentation", "modal");
  await expectElementVisibility(page, expect, "jskit-shell-drawer", true);
}

async function runAdaptiveShellSmokeCase({
  page,
  expect,
  smokePath = DEFAULT_SMOKE_PATH,
  viewport
} = {}) {
  if (!page || !expect || !viewport) {
    throw new Error("runAdaptiveShellSmokeCase requires page, expect, and viewport.");
  }

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(smokePath);
  await expect(page.locator("body")).toBeVisible();
  await expectGeneratedScreenContract(page, expect);
  await expectNoHorizontalOverflow(page, expect);
  const drawer = page.getByTestId("jskit-shell-drawer");
  const toggle = page.getByTestId("jskit-shell-nav-toggle");
  const layoutClass = await readShellLayoutClass(drawer);

  if (layoutClass === "compact") {
    let bootstrapRequests = 0;
    await page.route("**/api/bootstrap**", async (route) => {
      bootstrapRequests += 1;
      await route.continue();
    });
    const bootstrapRequestsBeforePull = bootstrapRequests;

    await expect(page.getByTestId("jskit-shell-bottom-nav")).toBeVisible();
    await expectElementVisibility(page, expect, "jskit-shell-drawer", false);

    await openCompactDrawer(page, expect);
    await toggle.click();
    await expectElementVisibility(page, expect, "jskit-shell-drawer", false);

    await openCompactDrawer(page, expect);
    await page.locator(".v-navigation-drawer__scrim").click();
    await expectElementVisibility(page, expect, "jskit-shell-drawer", false);

    await openCompactDrawer(page, expect);
    await page.keyboard.press("Escape");
    await expectElementVisibility(page, expect, "jskit-shell-drawer", false);
    await expect(toggle).toBeFocused();

    const navButtonHeights = await page.getByTestId("jskit-shell-bottom-nav").locator(".v-btn").evaluateAll((buttons) =>
      buttons.map((button) => button.getBoundingClientRect().height)
    );
    expect(navButtonHeights.length).toBeGreaterThan(0);
    for (const height of navButtonHeights) {
      expect(height).toBeGreaterThanOrEqual(48);
    }

    await pullToRefresh(page, expect);
    await expect.poll(() => bootstrapRequests).toBeGreaterThan(bootstrapRequestsBeforePull);
  } else {
    await expect(drawer).toBeVisible();
    if (await drawer.getAttribute("data-presentation") === "rail") {
      await toggle.click();
    }
    await expect(drawer).toHaveAttribute("data-presentation", "drawer");
    await expectDrawerWidth(drawer, expect, await readConfiguredWidth(drawer, "data-drawer-width"));
    await expectContentAwareDrawerFit(drawer, expect);
    const expandedIconCenters = await readNavigationIconCenters(drawer);
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveAttribute("data-presentation", "drawer");

    await toggle.click();
    await expect(drawer).toHaveAttribute("data-presentation", "rail");
    await expectDrawerWidth(drawer, expect, await readConfiguredWidth(drawer, "data-rail-width"));
    await expectCentredRailNavigation(page, drawer, expect, expandedIconCenters);
    await expectNoHorizontalOverflow(page, expect);
  }
}

function runAdaptiveShellSmoke({
  test,
  expect,
  smokePath = DEFAULT_SMOKE_PATH,
  viewports = DEFAULT_VIEWPORTS
} = {}) {
  if (!test || !expect) {
    throw new Error("runAdaptiveShellSmoke requires Playwright test and expect.");
  }

  test.describe("generated adaptive shell smoke", () => {
    for (const viewport of viewports) {
      test(`${viewport.name} layout has reachable navigation and no horizontal overflow`, async ({ page }) => {
        await runAdaptiveShellSmokeCase({ page, expect, smokePath, viewport });
      });
    }
  });
}

export {
  DEFAULT_VIEWPORTS,
  isRequestedOrDescendantLocation,
  runAdaptiveShellSmoke,
  runAdaptiveShellSmokeCase
};
