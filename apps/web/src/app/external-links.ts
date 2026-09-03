export interface LinkAttributes {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

export function configureNewTabLink(link: LinkAttributes): void {
  const rel = new Set((link.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean));
  rel.add("noopener");
  rel.add("noreferrer");
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", [...rel].join(" "));
}
