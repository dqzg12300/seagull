import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function isExternalHttpUrl(value?: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function MarkdownMessage({ content }: { content: string }) {
  return <div className="markdown-message">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => isExternalHttpUrl(href)
          ? <a href={href} onClick={event => { event.preventDefault(); void window.mobileReverse.openExternal(href).catch(() => undefined); }}>{children}</a>
          : <span className="markdown-link-disabled" title={href}>{children}</span>,
      }}
    >{content}</ReactMarkdown>
  </div>;
}
