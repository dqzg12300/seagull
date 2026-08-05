import { access, readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
for (const resource of [...pkg.pi.extensions, ...pkg.pi.skills, ...pkg.pi.prompts]) {
  await access(new URL(`../${resource.replace(/^\.\//, "")}`, import.meta.url));
}
console.log(`smoke ok: ${pkg.name}@${pkg.version}`);
