// Playwright helpers for the shell's app bar: its Up arrow and page title.

/**
 * The shell's Up arrow, the leading button of an inner page's app bar.
 * @param {import("@playwright/test").Page} page
 */
function shellBackButton(page) {
  return page.getByTestId("jskit-shell-back");
}

/**
 * The app bar's page title.
 * @param {import("@playwright/test").Page} page
 */
function shellPageTitle(page) {
  return page.getByTestId("jskit-shell-page-title");
}

/**
 * Presses the shell's Up arrow and waits for the URL to change. It waits for the arrow first, so a navigation that
 * is still opening the page has finished before the starting URL is read.
 * @param {import("@playwright/test").Page} page
 */
async function pressShellBack(page) {
  const button = shellBackButton(page);
  await button.waitFor();
  const before = page.url();
  await button.click();
  await page.waitForURL((url) => url.href !== before);
}

export { pressShellBack, shellBackButton, shellPageTitle };
