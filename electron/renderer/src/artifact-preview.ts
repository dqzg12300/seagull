export type ArtifactPreviewKind = "markdown" | "text";

/** Choose the renderer by extension so source and log files remain literal. */
export function artifactPreviewKind(filename?: string): ArtifactPreviewKind {
  if (!filename) return "text";
  return /\.(?:md|markdown)$/i.test(filename.trim()) ? "markdown" : "text";
}
