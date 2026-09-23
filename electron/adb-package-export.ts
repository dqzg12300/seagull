export function parseAdbPackagePaths(output: string): string[] {
  return [...new Set(output.split(/\r?\n/).map(line => line.trim()).flatMap(line => {
    const match = /^package:(\/.+\.apk)$/i.exec(line);
    return match?.[1] ? [match[1]] : [];
  }))];
}

export function safeAdbPackageStem(packageName: string): string {
  return packageName.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "android-package";
}

export function apkArchiveEntryNames(remotePaths: string[]): string[] {
  const used = new Set<string>();
  return remotePaths.map((remotePath, index) => {
    const raw = remotePath.split("/").at(-1)?.replace(/[^a-zA-Z0-9._-]+/g, "-") || `split-${index + 1}.apk`;
    const extension = raw.toLowerCase().endsWith(".apk") ? ".apk" : "";
    const stem = (extension ? raw.slice(0, -4) : raw) || `split-${index + 1}`;
    let candidate = `${stem}.apk`;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${stem}-${suffix++}.apk`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function shouldExportAdbPackage(metadata?: Record<string, string>): boolean {
  return metadata?.exportApk !== "false";
}
