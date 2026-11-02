import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Private native configuration; credentials must never enter browser responses. */
export function codexProviderConfiguration(provider, apiKey) {
  return {
    model_reasoning_summary: "none",
    web_search: provider.webSearch ? "live" : "disabled",
    [`model_providers.${provider.id}`]: {
      name: provider.label || provider.id, base_url: provider.baseUrl, wire_api: "responses",
      requires_openai_auth: false, experimental_bearer_token: apiKey
    }
  };
}

/** Where a curated provider home keeps the model catalogue its config.toml names. */
export function codexProviderCatalogPath(codexHome) {
  return path.join(codexHome, "models.json");
}

function codexProviderCatalogSetting(codexHome) {
  return `model_catalog_json = ${JSON.stringify(codexProviderCatalogPath(codexHome))}`;
}

/** Format a private native config file from an already-authorized provider and key. */
export function codexProviderFileConfiguration(provider, key, codexHome) {
  return [
    `model = ${JSON.stringify(provider.models[0].id)}`,
    `model_provider = ${JSON.stringify(provider.id)}`,
    codexProviderCatalogSetting(codexHome),
    `model_reasoning_effort = ${JSON.stringify(provider.models[0].defaultThinking)}`,
    'model_reasoning_summary = "none"',
    `web_search = "${provider.webSearch ? "live" : "disabled"}"`,
    `[model_providers.${provider.id}]`,
    `name = ${JSON.stringify(provider.label)}`,
    `base_url = ${JSON.stringify(provider.baseUrl)}`,
    'wire_api = "responses"',
    'requires_openai_auth = false',
    `experimental_bearer_token = ${JSON.stringify(key)}`,
    ""
  ].join("\n");
}

/**
 * Copy a curated provider home's config and catalogue into another home, with
 * the copied config naming the copied catalogue. A config that does not name
 * its own home's catalogue exactly once is refused rather than left pointing
 * at the source home.
 */
export async function copyCodexProviderHome(sourceHome, targetHome) {
  const config = await readFile(path.join(sourceHome, "config.toml"), "utf8");
  const sourceSetting = codexProviderCatalogSetting(sourceHome);
  if (config.split(sourceSetting).length !== 2) {
    throw new Error("Codex provider config does not name its own model catalogue.");
  }
  await writeFile(codexProviderCatalogPath(targetHome),
    await readFile(codexProviderCatalogPath(sourceHome)), { mode: 0o600 });
  await writeFile(path.join(targetHome, "config.toml"),
    config.replace(sourceSetting, codexProviderCatalogSetting(targetHome)), { mode: 0o600 });
}

export async function verifyCodexProviderKey(provider, apiKey, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${provider.baseUrl.replace(/\/$/u, "")}/responses`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: provider.models[0].id,
        input: "Reply with OK.",
        reasoning: { effort: "low" },
        max_output_tokens: 64,
        store: false
      })
    });
  } catch {
    throw new Error(`${provider.label} could not be reached. Your previous connection is unchanged; try again.`);
  }
  // Never expose a provider's raw response, which can contain request details.
  if (!response.ok) {
    // readable-check: allow optional-call - platform object: a fetch Response, whose body may be absent or lack cancel
    await response.body?.cancel?.();
    throw new Error(response.status === 401 || response.status === 403
      ? `${provider.label} rejected this key. Check the key and the required account plan.`
      : `${provider.label} could not complete a test request (HTTP ${response.status}). Check your plan or API credit.`);
  }
  const result = await response.json().catch(() => null);
  if (!result?.id || result.error || !Array.isArray(result.output) ||
      !["completed", "incomplete"].includes(result.status)) {
    throw new Error(`${provider.label} did not return a usable Responses API result. The key was not saved.`);
  }
}
