import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders useful Markdown blocks", () => {
    expect(renderMarkdown("## Result\n\n- **Done**\n- `tested`")).toContain("<h3>Result</h3><ul><li><strong>Done</strong></li><li><code>tested</code></li></ul>");
  });

  it("escapes untrusted markup while preserving safe links", () => {
    const rendered = renderMarkdown('<img src=x onerror=alert(1)> [Docs](https://example.com)');
    expect(rendered).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(rendered).toContain('href="https://example.com"');
    expect(rendered).toContain('target="_blank" rel="noopener noreferrer"');
  });
});
