import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(resolve(repositoryRoot, "apps/web/dist/browser/index.html"), "utf8");
const inlineHandler = /\son[a-z]+\s*=/i.exec(html);
if (inlineHandler) throw new Error(`Production index contains a CSP-blocked inline event handler: ${inlineHandler[0].trim()}`);
if (/javascript\s*:/i.test(html)) throw new Error("Production index contains a CSP-blocked javascript URL");
