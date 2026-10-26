import { InjectionToken } from "@angular/core";

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

export const BRANDING = new InjectionToken<Branding>("BRANDING");

function isBranding(value: unknown): value is Branding {
  if (!value || typeof value !== "object") return false;
  const branding = value as Partial<Branding>;
  return [branding.title, branding.shortName, branding.iconUrl, branding.themeColor, branding.backgroundColor].every((field) => typeof field === "string");
}

export async function loadBranding(fetcher: typeof fetch = fetch): Promise<Branding> {
  try {
    const response = await fetcher("/api/branding", { credentials: "same-origin", cache: "no-store" });
    const value: unknown = response.ok ? await response.json() : null;
    return isBranding(value) ? value : DEFAULT_BRANDING;
  } catch {
    return DEFAULT_BRANDING;
  }
}

export function applyBranding(branding: Branding): void {
  document.title = branding.title;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", branding.themeColor);
  document.querySelector('link[rel="icon"]')?.setAttribute("href", branding.iconUrl);
}
