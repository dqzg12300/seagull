import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage } from "../electron/renderer/src/MarkdownMessage.js";

describe("MarkdownMessage", () => {
  it("renders headings, GFM tables, lists, and fenced code", () => {
    const html = renderToStaticMarkup(<MarkdownMessage content={`## Result

- one
- two

| Key | Value |
| --- | --- |
| status | ok |

\`\`\`text
BUILD SUCCESSFUL
\`\`\``}/>);

    expect(html).toContain("<h2>Result</h2>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<table>");
    expect(html).toContain("BUILD SUCCESSFUL");
  });

  it("does not inject raw HTML from an assistant response", () => {
    const html = renderToStaticMarkup(<MarkdownMessage content={'<script>alert("x")</script>'}/>);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
