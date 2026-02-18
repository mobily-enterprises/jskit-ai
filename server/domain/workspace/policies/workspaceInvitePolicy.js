const DEFAULT_INVITE_EXPIRY_DAYS = 7;

function resolveInviteExpiresAt(inviteExpiryDays = DEFAULT_INVITE_EXPIRY_DAYS) {
  const normalizedInviteExpiryDays = Number.isInteger(Number(inviteExpiryDays)) && Number(inviteExpiryDays) > 0
    ? Number(inviteExpiryDays)
    : DEFAULT_INVITE_EXPIRY_DAYS;

  const date = new Date();
  date.setUTCDate(date.getUTCDate() + normalizedInviteExpiryDays);
  return date.toISOString();
}

export { DEFAULT_INVITE_EXPIRY_DAYS, resolveInviteExpiresAt };
