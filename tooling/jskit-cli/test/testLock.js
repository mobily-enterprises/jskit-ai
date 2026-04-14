import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

async function writeInstalledPackagesLock(appRoot, installedPackages = {}) {
  const lockDirectory = path.join(appRoot, ".jskit");
  await mkdir(lockDirectory, { recursive: true });
  await writeFile(
    path.join(lockDirectory, "lock.json"),
    `${JSON.stringify(
      {
        lockVersion: 1,
        installedPackages
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export { writeInstalledPackagesLock };
