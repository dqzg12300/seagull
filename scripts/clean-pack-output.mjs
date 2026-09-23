import { rm } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve("release-app");
for (const directory of ["win-unpacked", "win-unpacked.tmp"]) {
  const target = path.join(outputRoot, directory);
  if (path.dirname(target) !== outputRoot) throw new Error(`Unsafe package cleanup target: ${target}`);
  await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
