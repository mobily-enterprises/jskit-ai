function displayNameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "user";
  return local.slice(0, 120);
}

/**
 * The display name in a Supabase user's or its token claims' metadata, else
 * one made from the email.
 * @param {{ user_metadata?: { display_name?: unknown } } | null | undefined} source
 * @param {string} fallbackEmail
 */
function resolveDisplayName(source, fallbackEmail) {
  const metadataDisplayName = String(source?.user_metadata?.display_name || "").trim();
  if (metadataDisplayName) {
    return metadataDisplayName.slice(0, 120);
  }

  return displayNameFromEmail(fallbackEmail);
}

export { displayNameFromEmail, resolveDisplayName };
