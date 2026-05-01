function resolveAccountSettingsResourceId(_record, context = {}) {
  const userId = context?.request?.user?.id;
  if (userId == null || String(userId).trim() === "") {
    throw new Error("JSON:API account settings response requires request.user.id.");
  }

  return userId;
}

export { resolveAccountSettingsResourceId };
