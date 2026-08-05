import { execFile } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SkillInfo } from "./shared.js";

const execFileAsync = promisify(execFile);
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
const catalog: Array<SkillInfo & { url: string }> = [
  {
    id: "android-reverse-engineering",
    name: "android-reverse-engineering",
    description: "Decompile APK/XAPK/JAR/AAR files, trace Android call flows, and extract HTTP APIs.",
    source: "catalog",
    installed: false,
    repository: "SimoneAvogadro/android-reverse-engineering-skill",
    url: "https://github.com/SimoneAvogadro/android-reverse-engineering-skill/tree/main/plugins/android-reverse-engineering/skills/android-reverse-engineering",
  },
];

function parseFrontmatter(text: string): { name: string; description: string } {
  const block = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!block) throw new Error("SKILL.md is missing YAML frontmatter");
  const name = block[1]!.match(/^name:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim() ?? "";
  const description = block[1]!.match(/^description:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim() ?? "";
  if (!/^[a-z0-9-]{1,64}$/.test(name)) throw new Error("Skill name must use lowercase letters, numbers, and hyphens (max 64)");
  if (!description || description.length > 1024) throw new Error("Skill description is missing or too long");
  return { name, description };
}

async function scanDirectory(root: string, source: "bundled" | "installed"): Promise<SkillInfo[]> {
  try {
    const result: SkillInfo[] = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(root, entry.name, "SKILL.md");
      try {
        const metadata = parseFrontmatter(await readFile(skillFile, "utf8"));
        result.push({ id: metadata.name, ...metadata, source, installed: true, path: path.dirname(skillFile) });
      } catch { /* ignore invalid directories */ }
    }
    return result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function listSkills(projectRoot: string): Promise<SkillInfo[]> {
  const bundled = await scanDirectory(path.join(projectRoot, "skills"), "bundled");
  const installed = await scanDirectory(path.join(projectRoot, ".pi", "skills"), "installed");
  return [...bundled, ...installed].sort((a, b) => a.name.localeCompare(b.name));
}

export async function searchSkills(projectRoot: string, rawQuery: string): Promise<SkillInfo[]> {
  const query = rawQuery.trim().toLowerCase();
  const local = await listSkills(projectRoot);
  const installedNames = new Set(local.map(skill => skill.name));
  const available = catalog.map(skill => ({ ...skill, installed: installedNames.has(skill.name) }));
  return [...local, ...available.filter(skill => !installedNames.has(skill.name))]
    .filter(skill => !query || `${skill.name} ${skill.description} ${skill.repository ?? ""}`.toLowerCase().includes(query));
}

function parseGithubSkill(input: string): { repoUrl: string; ref: string; skillPath: string; repository: string } {
  const catalogItem = catalog.find(item => item.id === input);
  const value = catalogItem?.url ?? input;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a catalog skill ID or GitHub skill directory URL"); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") throw new Error("Only HTTPS GitHub skill URLs are supported");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2 || !/^[\w.-]+$/.test(parts[0]!) || !/^[\w.-]+$/.test(parts[1]!)) throw new Error("Invalid GitHub repository URL");
  const tree = parts[2] === "tree";
  const ref = tree ? parts[3] : "main";
  const skillPath = tree ? parts.slice(4).join("/") : "";
  if (!ref || ref.includes("..") || skillPath.split("/").some(part => part === "..")) throw new Error("Invalid GitHub ref or path");
  const repository = `${parts[0]}/${parts[1]!.replace(/\.git$/i, "")}`;
  return { repoUrl: `https://github.com/${repository}.git`, ref, skillPath, repository };
}

async function validateTree(root: string): Promise<void> {
  let total = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const info = await lstat(filename);
      if (info.isSymbolicLink()) throw new Error("Skill packages may not contain symbolic links");
      if (info.isDirectory()) await visit(filename);
      else { total += info.size; if (total > MAX_SKILL_BYTES) throw new Error("Skill package exceeds the 5 MB limit"); }
    }
  };
  await visit(root);
}

export async function installSkill(projectRoot: string, idOrUrl: string): Promise<SkillInfo> {
  const parsed = parseGithubSkill(idOrUrl.trim());
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "seagull-skill-"));
  const checkout = path.join(tempRoot, "repo");
  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--branch", parsed.ref, parsed.repoUrl, checkout], { timeout: 60_000, windowsHide: true });
    if (parsed.skillPath) await execFileAsync("git", ["sparse-checkout", "set", "--no-cone", parsed.skillPath], { cwd: checkout, timeout: 30_000, windowsHide: true });
    const source = path.resolve(checkout, parsed.skillPath || ".");
    if (!source.startsWith(path.resolve(checkout) + path.sep) && source !== path.resolve(checkout)) throw new Error("Skill path escaped the checkout");
    const metadata = parseFrontmatter(await readFile(path.join(source, "SKILL.md"), "utf8"));
    await validateTree(source);
    if ((await listSkills(projectRoot)).some(skill => skill.name === metadata.name)) throw new Error(`Skill '${metadata.name}' is already available`);
    const destinationRoot = path.join(projectRoot, ".pi", "skills");
    const destination = path.join(destinationRoot, metadata.name);
    await mkdir(destinationRoot, { recursive: true });
    try { await lstat(destination); throw new Error(`Skill '${metadata.name}' is already installed`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await cp(source, destination, { recursive: true, errorOnExist: true });
    return { id: metadata.name, ...metadata, source: "installed", installed: true, path: destination, repository: parsed.repository };
  } finally {
    if (tempRoot.startsWith(path.join(os.tmpdir(), "seagull-skill-"))) await rm(tempRoot, { recursive: true, force: true });
  }
}
