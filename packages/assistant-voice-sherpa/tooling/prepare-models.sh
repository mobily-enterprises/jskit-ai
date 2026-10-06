#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_root="$(cd "$script_dir/.." && pwd)"
models_root="${JSKIT_VOICE_MODELS_ROOT:?A model directory is required}"
download_cache="${JSKIT_VOICE_DOWNLOAD_CACHE:-${models_root}.downloads}"
source_manifest="${JSKIT_VOICE_SOURCES_FILE:-$package_root/models/voice-models.json}"
model_contract_builder="$script_dir/build-voice-model-contract.mjs"
model_contract_verifier="$script_dir/verify-voice-models.mjs"
bpe_vocab_source="$package_root/models/streaming-zipformer-en-2023-06-26.bpe.vocab"
hotwords_source="${JSKIT_VOICE_HOTWORDS_FILE:-$package_root/models/voice-hotwords.txt}"
node_bin="${JSKIT_VOICE_NODE_BIN:-node}"
archive_seed_root="${JSKIT_VOICE_ARCHIVE_SEED_ROOT:-}"
retain_downloads="${JSKIT_VOICE_RETAIN_DOWNLOADS:-0}"

case "$models_root" in
  ""|"/"|"$package_root")
    echo "[assistant-voice] Refusing unsafe models root: $models_root" >&2
    exit 1
    ;;
esac

for command_name in tar sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[assistant-voice] Required command is missing: $command_name" >&2
    exit 1
  fi
done
if ! command -v "$node_bin" >/dev/null 2>&1 && [ ! -x "$node_bin" ]; then
  echo "[assistant-voice] Required Node runtime is missing: $node_bin" >&2
  exit 1
fi
for required_file in \
  "$source_manifest" \
  "$model_contract_builder" \
  "$model_contract_verifier" \
  "$bpe_vocab_source" \
  "$hotwords_source"; do
  if [ ! -f "$required_file" ]; then
    echo "[assistant-voice] Required installer file is missing: $required_file" >&2
    exit 1
  fi
done
case "$retain_downloads" in
  0|1)
    ;;
  *)
    echo "[assistant-voice] JSKIT_VOICE_RETAIN_DOWNLOADS must be 0 or 1." >&2
    exit 64
    ;;
esac

read_model_field() {
  local model_id="$1"
  local field="$2"
  "$node_bin" -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const model = manifest.models.find((entry) => entry.id === process.argv[2]);
    if (!model || !model[process.argv[3]]) process.exit(2);
    process.stdout.write(String(model[process.argv[3]]));
  ' "$source_manifest" "$model_id" "$field"
}

model_ids="$("$node_bin" -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).models.map(model => model.id).join("\n"))' "$source_manifest")"

if [ -f "$models_root/voice-models.json" ] &&
   [ -f "$models_root/sources.json" ] &&
   cmp -s "$source_manifest" "$models_root/sources.json" &&
   cmp -s "$hotwords_source" "$models_root/stt/hotwords.txt" &&
   cmp -s "$bpe_vocab_source" "$models_root/stt/bpe.vocab" &&
   "$node_bin" "$model_contract_verifier" "$models_root"; then
  chmod 0755 "$models_root"
  if [ "$retain_downloads" = "0" ]; then
    while IFS= read -r model_id; do
      rm -f -- "$download_cache/$(read_model_field "$model_id" archive)"
    done <<< "$model_ids"
  fi
  echo "[assistant-voice] Reusing verified voice models at $models_root"
  exit 0
fi

mkdir -p "$download_cache" "$(dirname "$models_root")"
stage_root="$(mktemp -d "$(dirname "$models_root")/.voice-models.XXXXXX")"
extract_root="$(mktemp -d "$(dirname "$models_root")/.voice-extract.XXXXXX")"
previous_root="${models_root}.previous"

cleanup() {
  rm -rf -- "$stage_root" "$extract_root"
}
trap cleanup EXIT

fetch_archive() {
  local model_id="$1"
  local archive_name archive_path expected_hash actual_hash model_url
  archive_name="$(read_model_field "$model_id" archive)"
  expected_hash="$(read_model_field "$model_id" archiveSha256)"
  model_url="$(read_model_field "$model_id" url)"
  archive_path="$download_cache/$archive_name"

  if [ ! -f "$archive_path" ] &&
     [ -n "$archive_seed_root" ] &&
     [ -f "$archive_seed_root/$archive_name" ]; then
    cp -- "$archive_seed_root/$archive_name" "$archive_path"
  fi
  if [[ ! -f "$archive_path" ]]; then
    if ! command -v curl >/dev/null 2>&1; then
      echo "[assistant-voice] curl is required to download $archive_name" >&2
      exit 1
    fi
    echo "[assistant-voice] Downloading $archive_name" >&2
    curl --fail --silent --show-error --location --retry 3 --output "$archive_path.part" "$model_url"
    mv -- "$archive_path.part" "$archive_path"
  fi
  actual_hash="$(sha256sum "$archive_path" | awk '{print $1}')"
  if [[ "$actual_hash" != "$expected_hash" ]]; then
    echo "[assistant-voice] Archive hash mismatch for $archive_name" >&2
    exit 1
  fi
  printf '%s\n' "$archive_path"
}

archives=()
while IFS= read -r model_id; do
  archive="$(fetch_archive "$model_id")"
  archives+=("$archive")
  tar --no-same-owner -xjf "$archive" -C "$extract_root"
done <<< "$model_ids"

"$node_bin" "$script_dir/stage-voice-models.mjs" "$source_manifest" "$extract_root" "$stage_root"
install -m 0644 "$bpe_vocab_source" "$stage_root/stt/bpe.vocab"
install -m 0644 "$hotwords_source" "$stage_root/stt/hotwords.txt"
cp -- "$source_manifest" "$stage_root/sources.json"

"$node_bin" "$model_contract_builder" "$stage_root"
"$node_bin" "$model_contract_verifier" "$stage_root"
chmod 0755 "$stage_root"

rm -rf -- "$previous_root"
if [[ -e "$models_root" ]]; then
  mv -- "$models_root" "$previous_root"
fi
mv -- "$stage_root" "$models_root"
stage_root="$(mktemp -d "$(dirname "$models_root")/.voice-models-clean.XXXXXX")"
rm -rf -- "$previous_root"

if [ "$retain_downloads" = "0" ]; then
  rm -f -- "${archives[@]}"
fi

echo "[assistant-voice] Models ready at $models_root"
