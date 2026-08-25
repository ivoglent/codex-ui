import { Injectable, signal } from "@angular/core";
import type { Observable } from "rxjs";
import { filter } from "rxjs";
import { BUNDLE_COMMIT, BUNDLE_VERSION } from "./bundle-version.generated";

/**
 * Subset of `@angular/service-worker`'s `SwUpdate` surface this module needs.
 * Defining a local interface keeps tests free of the service-worker runtime
 * so they can run under vitest without the JIT compiler. `main.ts` wires the
 * real `SwUpdate` to this interface when the worker is registered.
 */
export interface AppUpdater {
  readonly isEnabled: boolean;
  readonly versionUpdates: Observable<{ type: string }>;
  activateUpdate(): Promise<boolean>;
}

export interface UpdateAvailable {
  version: string;
  commit: string | null;
}

export interface VersionInfo {
  application: string;
  commit: string | null;
  node: string;
  codex: string | null;
  generatedProtocol: string;
  compatible: boolean;
  error?: string;
}

/**
 * Surfaces service-worker update notifications and exposes the running build
 * version. Replaces the previous auto-reload behaviour: a user with unsent
 * chat input should not lose it because the deploy pipeline shipped a new
 * bundle, so we prompt and let them decide when to swap in the new worker.
 */
@Injectable({ providedIn: "root" })
export class UpdateService {
  private updater: AppUpdater | null = null;
  readonly available = signal<UpdateAvailable | null>(null);
  readonly running = signal<VersionInfo | null>(null);
  readonly checkedAt = signal<number | null>(null);
  readonly currentVersion = BUNDLE_VERSION;
  readonly currentCommit = BUNDLE_COMMIT;

  constructor() {
    void this.refresh();
    // Expose the service on window only when the URL opts in. e2e tests
    // append `?codexTest=1` to drive the banner without depending on the
    // real service-worker registration. Production traffic never carries
    // the flag, so the global is never assigned in normal use.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("codexTest") === "1") (window as unknown as { __codexUpdateService?: UpdateService }).__codexUpdateService = this;
    }
  }

  /**
   * Wires the real service-worker controller. Called once from `main.ts`
   * after Angular has finished bootstrapping so the service stays usable
   * in tests that don't have a service worker available.
   */
  bind(updater: AppUpdater | null): void {
    if (this.updater) return;
    this.updater = updater;
    if (!updater || !updater.isEnabled) return;
    updater.versionUpdates
      .pipe(filter((event) => event.type === "VERSION_READY"))
      .subscribe(() => { void this.refresh(); });
    void this.refresh();
  }

  /** Refresh both the running version (Settings display) and the update signal. */
  async refresh(): Promise<void> {
    try {
      const response = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return;
      const body = (await response.json()) as VersionInfo;
      this.running.set(body);
      this.checkedAt.set(Date.now());
      // If the server reports a different application version than the one
      // baked into this bundle, surface a banner so the user can reload.
      if (body.application && body.application !== BUNDLE_VERSION) {
        this.available.set({ version: body.application, commit: body.commit ?? null });
      }
    } catch {
      // Transient network failure; leave signals untouched.
    }
  }

  /** Apply the pending service-worker update and reload the page. */
  async applyUpdate(): Promise<void> {
    this.available.set(null);
    if (!this.updater || !this.updater.isEnabled) {
      location.reload();
      return;
    }
    try {
      await this.updater.activateUpdate();
    } catch {
      // Fall through to reload — the next fetch will pick up the new files
      // because the service worker has already cached them.
    }
    location.reload();
  }

  /** Dismiss the update notification without reloading. */
  dismiss(): void { this.available.set(null); }
}
