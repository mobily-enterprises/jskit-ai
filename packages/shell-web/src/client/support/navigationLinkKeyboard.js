function activateShellNavigationLinkOnSpace(event) {
  if (event?.key !== " " || typeof event.currentTarget?.click !== "function") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.click();
}

export { activateShellNavigationLinkOnSpace };
