import {
  SERVER_EXTENSION_FILE_SUFFIX,
  toPosix,
  sortExtensions,
  assertUniqueIds,
  resolveServerDropinChannels,
  normalizeServerExtension,
  normalizeSettingsExtension,
  normalizeWorkerExtension,
  composeServerRuntimeBundle
} from "../lib/appDropins.js";

async function loadNodeServerModules() {
  const [fsModule, pathModule, urlModule] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
    import("node:url")
  ]);

  return {
    fs: fsModule.default ?? fsModule,
    path: pathModule.default ?? pathModule,
    pathToFileURL: urlModule.pathToFileURL
  };
}

async function readServerExtensionFiles({ fs, path, directoryPath }) {
  let directoryEntries;
  try {
    directoryEntries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(SERVER_EXTENSION_FILE_SUFFIX))
    .map((entry) => ({
      fileName: entry.name,
      filePath: path.join(directoryPath, entry.name)
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

async function loadServerExtensionFamily({ appDir, directoryName, familyLabel, normalizer, nodeModules }) {
  const { fs, path, pathToFileURL } = nodeModules || (await loadNodeServerModules());
  const directoryPath = path.join(appDir, directoryName);
  const files = await readServerExtensionFiles({ fs, path, directoryPath });
  const loaded = [];

  for (const file of files) {
    const imported = await import(/* @vite-ignore */ pathToFileURL(file.filePath).href);
    const descriptor = imported?.default ?? imported;
    const relativePath = toPosix(path.relative(appDir, file.filePath));
    const normalized = normalizer(descriptor, `${familyLabel} extension "${relativePath}"`);

    loaded.push(
      Object.freeze({
        ...normalized,
        fileName: file.fileName,
        filePath: file.filePath,
        relativePath
      })
    );
  }

  const sorted = sortExtensions(loaded, (entry) => entry.fileName);
  assertUniqueIds(sorted, familyLabel, (entry) => entry.relativePath);
  return Object.freeze(sorted);
}

async function loadServerAppDropins({
  appDir,
  extensionDirectory = "extensions.d",
  settingsDirectory = "settings.extensions.d",
  workersDirectory = "workers.extensions.d",
  additionalChannels = []
} = {}) {
  if (!appDir) {
    throw new TypeError("loadServerAppDropins requires appDir.");
  }

  const nodeModules = await loadNodeServerModules();
  const channels = resolveServerDropinChannels({
    extensionDirectory,
    settingsDirectory,
    workersDirectory,
    additionalChannels
  });

  const normalizerByKind = Object.freeze({
    server: normalizeServerExtension,
    settings: normalizeSettingsExtension,
    workers: normalizeWorkerExtension
  });

  const loadedByChannel = new Map();
  const serverExtensions = [];
  const settingsExtensions = [];
  const workerExtensions = [];

  for (const channel of channels) {
    const familyEntries = await loadServerExtensionFamily({
      appDir,
      directoryName: channel.directoryName,
      familyLabel: `${channel.kind}:${channel.key}`,
      normalizer: normalizerByKind[channel.kind],
      nodeModules
    });

    loadedByChannel.set(channel.key, familyEntries);

    if (channel.kind === "server") {
      serverExtensions.push(...familyEntries);
      continue;
    }
    if (channel.kind === "settings") {
      settingsExtensions.push(...familyEntries);
      continue;
    }
    workerExtensions.push(...familyEntries);
  }

  const bundle = composeServerRuntimeBundle({
    serverExtensions,
    settingsExtensions,
    workerExtensions
  });
  const channelEntries = Object.fromEntries(
    channels.map((channel) => [channel.key, Object.freeze([...(loadedByChannel.get(channel.key) || [])])])
  );
  const channelKinds = Object.fromEntries(channels.map((channel) => [channel.key, channel.kind]));

  return Object.freeze({
    ...bundle,
    channels: Object.freeze(channelEntries),
    channelKinds: Object.freeze(channelKinds),
    channelOrder: Object.freeze(channels.map((channel) => channel.key))
  });
}

export { loadServerAppDropins };
