import { describe, expect, it } from "vitest";
import { artifactPreviewKind } from "../electron/renderer/src/artifact-preview.js";

describe("artifact preview kind", () => {
  it.each(["report.md", "D:\\case\\DELIVERY.MD", "/tmp/readme.markdown"])("renders Markdown artifacts: %s", filename => {
    expect(artifactPreviewKind(filename)).toBe("markdown");
  });

  it.each(["agent.log", "source.java", "notes.txt", undefined])("keeps non-Markdown artifacts as raw text: %s", filename => {
    expect(artifactPreviewKind(filename)).toBe("text");
  });
});
