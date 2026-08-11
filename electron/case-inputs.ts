import type { CaseInput } from "./shared.js";

type InputIdentityFields = Pick<CaseInput, "type" | "path" | "packageName" | "sha256" | "metadata">;

/** Stable identity used to prevent the same material from being attached repeatedly. */
export function caseInputIdentity(input: InputIdentityFields): string | undefined {
  const digest = input.sha256?.trim().toLowerCase();
  if (digest) return `sha256:${digest}`;
  if (input.type === "device-package" && input.packageName) {
    return `device:${input.metadata?.serial?.trim().toLowerCase() ?? ""}:${input.packageName.trim().toLowerCase()}`;
  }
  const filename = input.path?.trim().replaceAll("\\", "/").toLowerCase();
  return filename ? `path:${filename}` : undefined;
}

export function dedupeCaseInputs(inputs: CaseInput[], primaryInputId?: string): { inputs: CaseInput[]; primaryInputId?: string; removedIds: string[] } {
  const preferred = primaryInputId
    ? [...inputs.filter(input => input.id === primaryInputId), ...inputs.filter(input => input.id !== primaryInputId)]
    : inputs;
  const identities = new Set<string>();
  const keptIds = new Set<string>();
  for (const input of preferred) {
    const identity = caseInputIdentity(input);
    if (identity && identities.has(identity)) continue;
    if (identity) identities.add(identity);
    keptIds.add(input.id);
  }
  const deduped = inputs.filter(input => keptIds.has(input.id));
  return {
    inputs: deduped,
    primaryInputId: deduped.some(input => input.id === primaryInputId) ? primaryInputId : deduped[0]?.id,
    removedIds: inputs.filter(input => !keptIds.has(input.id)).map(input => input.id),
  };
}
