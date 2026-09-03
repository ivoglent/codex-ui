const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (value: string) => escape(value)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

export function renderMarkdown(source: string): string {
  const blocks: string[] = [];
  const text = source.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, language, code) => { const token = `@@CODE${blocks.length}@@`; blocks.push(`<pre><code data-language="${escape(language)}">${escape(code.trimEnd())}</code></pre>`); return token; });
  const lines = text.split("\n"); const output: string[] = []; let list: string[] = [];
  const flush = () => { if (list.length) { output.push(`<ul>${list.join("")}</ul>`); list = []; } };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.includes("|") && lines[index + 1]?.match(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/)) {
      flush(); const cells = (value: string) => value.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => `<td>${inline(cell.trim())}</td>`).join("");
      output.push(`<div class="table-scroll"><table><thead><tr>${cells(line).replaceAll("<td>", "<th>").replaceAll("</td>", "</th>")}</tr></thead><tbody>`);
      index += 2; while (index < lines.length && lines[index].includes("|")) { output.push(`<tr>${cells(lines[index])}</tr>`); index++; } output.push("</tbody></table></div>"); index--; continue;
    }
    const item = /^[-*]\s+(.+)/.exec(line); if (item) { list.push(`<li>${inline(item[1])}</li>`); continue; } flush();
    const heading = /^(#{1,3})\s+(.+)/.exec(line); if (heading) output.push(`<h${heading[1].length + 1}>${inline(heading[2])}</h${heading[1].length + 1}>`);
    else if (/^@@CODE\d+@@$/.test(line)) output.push(line);
    else if (/^>\s+/.test(line)) output.push(`<blockquote>${inline(line.replace(/^>\s+/, ""))}</blockquote>`);
    else if (line.trim()) output.push(`<p>${inline(line)}</p>`);
  }
  flush(); return output.join("").replace(/@@CODE(\d+)@@/g, (_, index) => blocks[Number(index)]);
}
