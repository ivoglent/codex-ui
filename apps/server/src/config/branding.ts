export interface Branding {
  title: string;
  shortName: string;
  iconUrl: string;
  themeColor: string;
  backgroundColor: string;
}

export const DEFAULT_BRANDING: Branding = {
  title: "Codex Control",
  shortName: "Codex",
  iconUrl: "/favicon.svg",
  themeColor: "#111827",
  backgroundColor: "#090d16"
};

const COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;

function text(value: string | undefined, fallback: string, variable: string, maximum: number): string {
  if (value === undefined || !value.trim()) return fallback;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error(`${variable} must be plain text of at most ${maximum} characters`);
  return normalized;
}

function color(value: string | undefined, fallback: string, variable: string): string {
  if (value === undefined || !value.trim()) return fallback;
  const normalized = value.trim();
  if (!COLOR.test(normalized)) throw new Error(`${variable} must be a #RRGGBB or #RRGGBBAA color`);
  return normalized;
}

function iconUrl(value: string | undefined): string {
  if (value === undefined || !value.trim()) return DEFAULT_BRANDING.iconUrl;
  const candidate = value.trim();
  if (!candidate.startsWith("/")) throw new Error("APP_ICON_URL must be a same-origin absolute path");
  let parsed: URL;
  try { parsed = new URL(candidate, "https://branding.invalid"); }
  catch { throw new Error("APP_ICON_URL must be a same-origin absolute path"); }
  if (parsed.origin !== "https://branding.invalid" || parsed.search || parsed.hash) throw new Error("APP_ICON_URL must be a same-origin absolute path without query or fragment");
  return parsed.pathname;
}

/** Deployment-owned visual identity. Values are intentionally not user-editable. */
export function brandingFromEnvironment(env: NodeJS.ProcessEnv = process.env): Branding {
  const title = text(env.APP_TITLE, DEFAULT_BRANDING.title, "APP_TITLE", 80);
  const defaultShortName = title.length <= 24 ? title : title.slice(0, 24).trimEnd();
  return {
    title,
    shortName: text(env.APP_SHORT_NAME, title === DEFAULT_BRANDING.title ? DEFAULT_BRANDING.shortName : defaultShortName, "APP_SHORT_NAME", 24),
    iconUrl: iconUrl(env.APP_ICON_URL),
    themeColor: color(env.APP_THEME_COLOR, DEFAULT_BRANDING.themeColor, "APP_THEME_COLOR"),
    backgroundColor: color(env.APP_BACKGROUND_COLOR, DEFAULT_BRANDING.backgroundColor, "APP_BACKGROUND_COLOR")
  };
}

export function brandingManifest(branding: Branding): Record<string, unknown> {
  return {
    name: branding.title,
    short_name: branding.shortName,
    start_url: "/",
    display: "standalone",
    background_color: branding.backgroundColor,
    theme_color: branding.themeColor,
    icons: [{ src: branding.iconUrl, sizes: "any", purpose: "any maskable" }]
  };
}
