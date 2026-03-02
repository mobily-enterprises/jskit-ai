function displayNameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "user";
  return local.slice(0, 120);
}

function resolveDisplayName(supabaseUser, fallbackEmail) {
  const metadataDisplayName = String(supabaseUser?.user_metadata?.display_name || "").trim();
  if (metadataDisplayName) {
    return metadataDisplayName.slice(0, 120);
  }

  return displayNameFromEmail(fallbackEmail);
}

function resolveDisplayNameFromClaims(claims, fallbackEmail) {
  const metadataDisplayName = String(claims?.user_metadata?.display_name || "").trim();
  if (metadataDisplayName) {
    return metadataDisplayName.slice(0, 120);
  }

  return displayNameFromEmail(fallbackEmail);
}

export { displayNameFromEmail, resolveDisplayName, resolveDisplayNameFromClaims };
