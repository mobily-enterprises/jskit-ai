function renderBundlePayloadText({ payload, stdout, color, writeField } = {}) {
  stdout.write(`${color.heading("Information")}\n`);
  writeField("Bundle", payload.bundleId, color.item);
  writeField("Version", payload.version, color.installed);
  if (payload.description) {
    writeField("Description", payload.description);
  }
  stdout.write(`${color.heading(`Packages (${payload.packages.length}):`)}\n`);
  for (const packageId of payload.packages) {
    stdout.write(`- ${color.item(packageId)}\n`);
  }
}

export {
  renderBundlePayloadText
};
