function createPublishablePackageManifest(packageJson = {}) {
  const manifest = { ...packageJson };
  delete manifest.private;
  return manifest;
}

export { createPublishablePackageManifest };
