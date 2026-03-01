const DEFAULT_INVITE_TTL_HOURS = 72;

function resolveInviteExpiresAt(now = new Date()) {
  const timestamp = Number(now instanceof Date ? now.getTime() : Date.now());
  return new Date(timestamp + DEFAULT_INVITE_TTL_HOURS * 60 * 60 * 1000);
}

export { DEFAULT_INVITE_TTL_HOURS, resolveInviteExpiresAt };
