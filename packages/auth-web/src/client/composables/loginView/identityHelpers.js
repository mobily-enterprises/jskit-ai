function normalizeEmailAddress(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function maskEmail(emailAddress) {
  const normalized = normalizeEmailAddress(emailAddress);
  const separatorIndex = normalized.indexOf("@");
  if (separatorIndex <= 0) {
    return normalized;
  }

  const localPart = normalized.slice(0, separatorIndex);
  const domainPart = normalized.slice(separatorIndex + 1);
  const visiblePrefix = localPart.slice(0, 1);
  return `${visiblePrefix}***@${domainPart}`;
}

export {
  normalizeEmailAddress,
  maskEmail
};
