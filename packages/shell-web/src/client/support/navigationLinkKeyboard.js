function activateShellNavigationLinkOnSpace(event) {
  if (event.key !== " ") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.click();
}

export { activateShellNavigationLinkOnSpace };
