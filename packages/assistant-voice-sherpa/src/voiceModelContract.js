import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const VOICE_MODEL_CONTRACT_SCHEMA = "vibe64.voice-models.v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function modelContractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function modelFilePath(modelsRoot = "", relativePath = "") {
  const root = path.resolve(String(modelsRoot || ""));
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw modelContractError(
      "voice_model_path_invalid",
      `Voice model contract contains an invalid path: ${relativePath || "(missing)"}.`
    );
  }
  const resolved = path.resolve(root, normalized);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw modelContractError(
      "voice_model_path_escape",
      `Voice model path escapes its runtime pack: ${relativePath}.`
    );
  }
  return resolved;
}

async function sha256File(filePath = "") {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolve);
  });
  return hash.digest("hex");
}

async function readVoiceModelContract({ contractPath = "", modelsRoot = "" } = {}) {
  const resolvedContractPath = path.resolve(String(contractPath || path.join(modelsRoot, "voice-models.json")));
  let contract;
  try {
    contract = JSON.parse(await readFile(resolvedContractPath, "utf8"));
  } catch (error) {
    throw modelContractError(
      "voice_model_contract_unreadable",
      `Voice model contract could not be read: ${String(error?.message || error)}.`
    );
  }
  if (contract?.schema !== VOICE_MODEL_CONTRACT_SCHEMA || !Array.isArray(contract.files)) {
    throw modelContractError(
      "voice_model_contract_invalid",
      `Voice model contract must use ${VOICE_MODEL_CONTRACT_SCHEMA}.`
    );
  }
  return Object.freeze({
    ...contract,
    contractPath: resolvedContractPath,
    files: contract.files.map((entry) => Object.freeze({
      bytes: Number(entry?.bytes),
      path: String(entry?.path || ""),
      sha256: String(entry?.sha256 || "").trim().toLowerCase()
    }))
  });
}

async function verifyVoiceModelContract({ contractPath = "", modelsRoot = "" } = {}) {
  const contract = await readVoiceModelContract({ contractPath, modelsRoot });
  if (!contract.files.length) {
    throw modelContractError("voice_model_contract_empty", "Voice model contract contains no files.");
  }
  for (const entry of contract.files) {
    if (!SHA256_PATTERN.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) {
      throw modelContractError(
        "voice_model_contract_file_invalid",
        `Voice model contract entry is invalid: ${entry.path || "(missing path)"}.`
      );
    }
    const filePath = modelFilePath(modelsRoot, entry.path);
    let metadata;
    try {
      metadata = await stat(filePath);
    } catch {
      throw modelContractError(
        "voice_model_file_missing",
        `Required voice model file is missing: ${entry.path}.`
      );
    }
    if (!metadata.isFile() || metadata.size !== entry.bytes) {
      throw modelContractError(
        "voice_model_file_size_mismatch",
        `Voice model file size does not match its contract: ${entry.path}.`
      );
    }
    if (await sha256File(filePath) !== entry.sha256) {
      throw modelContractError(
        "voice_model_file_hash_mismatch",
        `Voice model file hash does not match its contract: ${entry.path}.`
      );
    }
  }
  return contract;
}

export {
  VOICE_MODEL_CONTRACT_SCHEMA,
  modelFilePath,
  readVoiceModelContract,
  sha256File,
  verifyVoiceModelContract
};
