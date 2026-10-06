const MAX_VISEME_CUES = 180;

const CLUSTER_VISEMES = new Map([
  ["ough", ["round", 0.66, 1.5]],
  ["tion", ["small", 0.52, 1.35]],
  ["ch", ["small", 0.52, 0.9]],
  ["ee", ["wide", 0.62, 1.15]],
  ["ea", ["wide", 0.62, 1.15]],
  ["er", ["round", 0.58, 1.05]],
  ["ir", ["round", 0.58, 1.05]],
  ["ng", ["small", 0.48, 0.85]],
  ["oo", ["round", 0.7, 1.2]],
  ["ou", ["round", 0.72, 1.2]],
  ["ow", ["round", 0.7, 1.15]],
  ["oy", ["round", 0.66, 1.15]],
  ["ph", ["wide", 0.48, 0.9]],
  ["qu", ["round", 0.62, 1.05]],
  ["sh", ["small", 0.52, 0.9]],
  ["th", ["small", 0.5, 0.9]],
  ["ur", ["round", 0.58, 1.05]],
  ["wh", ["round", 0.58, 0.95]],
  ["zh", ["small", 0.52, 0.9]]
]);

function characterViseme(character = "") {
  if (/[pbm]/u.test(character)) return ["closed", 0.12, 0.72];
  if (/[fv]/u.test(character)) return ["wide", 0.44, 0.82];
  if (/[ouqw]/u.test(character)) return ["round", 0.68, 1.08];
  if (/[eiy]/u.test(character)) return ["wide", 0.6, 1.02];
  if (/[a]/u.test(character)) return ["open", 0.86, 1.2];
  if (/[ckg]/u.test(character)) return ["open", 0.58, 0.82];
  if (/[h]/u.test(character)) return ["open", 0.48, 0.7];
  if (/[r]/u.test(character)) return ["round", 0.52, 0.84];
  return ["small", 0.46, 0.72];
}

function appendUnit(units, pose, level, weight) {
  const previous = units.at(-1);
  if (previous?.pose === pose && previous.weight + weight <= 2.4) {
    previous.level = Math.max(previous.level, level);
    previous.weight += weight;
    return;
  }
  units.push({ level, pose, weight });
}

function visemeUnitsFromText(value = "") {
  const text = String(value || "").toLowerCase();
  const units = [];
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (/\s/u.test(character)) {
      appendUnit(units, "closed", 0, 0.48);
      index += 1;
      continue;
    }
    if (/[.,!?;:()[\]{}—–-]/u.test(character)) {
      appendUnit(units, "closed", 0, /[.!?]/u.test(character) ? 1.15 : 0.72);
      index += 1;
      continue;
    }
    if (!/[a-z0-9]/u.test(character)) {
      index += 1;
      continue;
    }
    let matched = false;
    for (const size of [4, 3, 2]) {
      const cluster = text.slice(index, index + size);
      const mapping = CLUSTER_VISEMES.get(cluster);
      if (!mapping) {
        continue;
      }
      appendUnit(units, ...mapping);
      index += size;
      matched = true;
      break;
    }
    if (matched) {
      continue;
    }
    if (/\d/u.test(character)) {
      appendUnit(units, "small", 0.5, 0.76);
    } else {
      appendUnit(units, ...characterViseme(character));
    }
    index += 1;
  }
  if (units.length <= MAX_VISEME_CUES) {
    return units;
  }
  const stride = Math.ceil(units.length / MAX_VISEME_CUES);
  return units.filter((_unit, index) => index % stride === 0);
}

function visemeCuesFromText(value = "", durationMs = 0) {
  const duration = Math.max(80, Number(durationMs) || 0);
  const units = visemeUnitsFromText(value);
  if (!units.length) {
    return Object.freeze([
      Object.freeze({ atMs: 0, level: 0, pose: "closed" })
    ]);
  }
  const leadMs = Math.min(70, duration * 0.055);
  const tailMs = Math.min(90, duration * 0.07);
  const availableMs = Math.max(1, duration - leadMs - tailMs);
  const totalWeight = units.reduce((total, unit) => total + unit.weight, 0);
  const cues = [{ atMs: 0, level: 0, pose: "closed" }];
  let cursor = leadMs;
  for (const unit of units) {
    cues.push({
      atMs: Math.round(cursor),
      level: Number(unit.level.toFixed(2)),
      pose: unit.pose
    });
    cursor += availableMs * (unit.weight / totalWeight);
  }
  cues.push({
    atMs: Math.max(0, Math.round(duration - tailMs)),
    level: 0,
    pose: "closed"
  });
  return Object.freeze(cues.map((cue) => Object.freeze(cue)));
}

export {
  MAX_VISEME_CUES,
  characterViseme,
  visemeCuesFromText,
  visemeUnitsFromText
};
