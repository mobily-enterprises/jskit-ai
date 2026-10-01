const MOUTH_POSES = new Set(["closed", "open", "round", "small", "wide"]);

function pcm16ArrayBufferToFloat32(buffer) {
  const source = new DataView(buffer);
  const samples = new Float32Array(Math.floor(source.byteLength / 2));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = source.getInt16(index * 2, true) / 32768;
  }
  return samples;
}

function normalizeSpeechSegment(message = {}, sampleRate = 22_050) {
  const sampleCount = Math.max(0, Math.floor(Number(message.sampleCount) || 0));
  const durationMs = sampleCount
    ? (sampleCount / Math.max(1, Number(sampleRate) || 22_050)) * 1_000
    : Math.max(0, Number(message.durationMs) || 0);
  const cues = (Array.isArray(message.cues) ? message.cues : [])
    .map((cue) => ({
      atMs: Math.min(durationMs, Math.max(0, Number(cue?.atMs) || 0)),
      level: Math.min(1, Math.max(0, Number(cue?.level) || 0)),
      pose: MOUTH_POSES.has(String(cue?.pose || "")) ? String(cue.pose) : "closed"
    }))
    .sort((left, right) => left.atMs - right.atMs);
  return {
    cues,
    durationMs,
    remainingSamples: sampleCount,
    sampleCount,
    startedAt: null
  };
}

function visemeCueAtTime(segments = [], currentTime = 0) {
  const segment = segments.find((entry) => (
    Number.isFinite(entry?.startedAt) &&
    currentTime >= entry.startedAt &&
    currentTime <= entry.startedAt + (entry.durationMs / 1_000)
  ));
  if (!segment) {
    return null;
  }
  const elapsedMs = Math.max(0, (currentTime - segment.startedAt) * 1_000);
  let active = null;
  for (const cue of segment.cues) {
    if (cue.atMs > elapsedMs) {
      break;
    }
    active = cue;
  }
  return active;
}

export {
  MOUTH_POSES,
  normalizeSpeechSegment,
  pcm16ArrayBufferToFloat32,
  visemeCueAtTime
};
