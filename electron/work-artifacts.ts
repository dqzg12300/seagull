import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type ArtifactWorkState = {
  id: string;
  createdAt?: string;
  run?: { taskDir?: string; workspaceDir?: string; [key: string]: unknown };
  artifacts?: string[];
  artifactSnapshot?: string[];
};

export type ArtifactCaseState = {
  activeWorkId?: string;
  activeRun?: ArtifactWorkState["run"];
  artifacts?: string[];
  works?: ArtifactWorkState[];
};

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(candidate: string, root: string): boolean {
  const value = pathKey(candidate);
  const owner = pathKey(root);
  return value === owner || value.startsWith(owner + path.sep);
}

async function existingKind(value: string): Promise<"file" | "directory" | undefined> {
  try { return (await stat(value)).isDirectory() ? "directory" : "file"; }
  catch { return undefined; }
}

async function matchingDirectory(caseDir: string, buckets: string[], workId: string): Promise<string | undefined> {
  for (const bucket of buckets) {
    const parent = path.join(caseDir, bucket);
    let entries;
    try { entries = await readdir(parent, { withFileTypes: true }); }
    catch { continue; }
    const match = entries
      .filter(entry => entry.isDirectory())
      .find(entry => entry.name === workId || entry.name.endsWith(`-${workId}`) || entry.name.includes(workId));
    if (match) return path.join(parent, match.name);
  }
  return undefined;
}

async function immediateFiles(directory: string | undefined): Promise<string[]> {
  if (!directory) return [];
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter(entry => entry.isFile()).map(entry => path.join(directory, entry.name));
  } catch { return []; }
}

function uniqueExisting(values: Array<string | undefined>): Promise<string[]> {
  return Promise.all([...new Set(values.filter((value): value is string => Boolean(value)))].map(async value => ({ value, kind: await existingKind(value) })))
    .then(items => items.filter(item => item.kind).map(item => item.value));
}

/**
 * Repair Work ownership for CASE files created before isolated `works/`
 * directories were introduced. Existing files are never moved: the migration
 * only rebuilds indexes from task/project roots and the CASE-wide registry.
 */
export async function rebuildWorkArtifactOwnership(state: ArtifactCaseState, caseDir: string): Promise<boolean> {
  if (!state.works?.length) return false;
  let changed = false;
  const ordered = [...state.works].sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""));
  const rootsByWork = new Map<string, string[]>();

  for (const work of ordered) {
    work.run ??= {};
    let taskDir = work.run.taskDir && await existingKind(work.run.taskDir) === "directory" ? work.run.taskDir : undefined;
    taskDir ??= await matchingDirectory(caseDir, ["works", "tasks"], work.id);
    let workspaceDir = work.run.workspaceDir && await existingKind(work.run.workspaceDir) === "directory" ? work.run.workspaceDir : undefined;
    if (!workspaceDir && taskDir && await existingKind(path.join(taskDir, "project")) === "directory") workspaceDir = path.join(taskDir, "project");
    workspaceDir ??= await matchingDirectory(caseDir, ["projects"], work.id);

    if (taskDir && work.run.taskDir !== taskDir) { work.run.taskDir = taskDir; changed = true; }
    if (workspaceDir && work.run.workspaceDir !== workspaceDir) { work.run.workspaceDir = workspaceDir; changed = true; }

    const roots = [...new Set([taskDir, workspaceDir].filter((value): value is string => Boolean(value)))];
    rootsByWork.set(work.id, roots);
    const discovered = await uniqueExisting([
      ...roots,
      ...await immediateFiles(taskDir),
      ...(workspaceDir && workspaceDir !== taskDir ? await immediateFiles(workspaceDir) : []),
    ]);
    const retained = await uniqueExisting(work.artifacts ?? []);
    const next = [...new Set([...retained, ...discovered])];
    if (JSON.stringify(next) !== JSON.stringify(work.artifacts ?? [])) { work.artifacts = next; changed = true; }
  }

  const ownedRoots = [...rootsByWork.values()].flat();
  const shared = await uniqueExisting((state.artifacts ?? []).filter(artifact => !ownedRoots.some(root => isWithin(artifact, root))));
  const first = ordered[0];
  if (first && shared.length) {
    const next = [...new Set([...(first.artifacts ?? []), ...shared])];
    if (JSON.stringify(next) !== JSON.stringify(first.artifacts ?? [])) { first.artifacts = next; changed = true; }
  }

  const inherited: string[] = [];
  for (const work of ordered) {
    const snapshot = [...new Set(inherited)];
    if (JSON.stringify(snapshot) !== JSON.stringify(work.artifactSnapshot ?? [])) { work.artifactSnapshot = snapshot; changed = true; }
    inherited.push(...(work.artifacts ?? []));
  }

  const active = state.works.find(work => work.id === state.activeWorkId);
  if (active?.run && JSON.stringify(state.activeRun) !== JSON.stringify(active.run)) { state.activeRun = structuredClone(active.run); changed = true; }
  return changed;
}

export function allIndexedArtifacts(state: { artifacts?: string[]; works?: Array<{ artifacts?: string[]; artifactSnapshot?: string[] }> }): string[] {
  return [...new Set([
    ...(state.artifacts ?? []),
    ...(state.works ?? []).flatMap(work => [...(work.artifacts ?? []), ...(work.artifactSnapshot ?? [])]),
  ])];
}
