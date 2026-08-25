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
  // Persisted across reloads so the banner does not re-appear every time the
  // user rejects Reload/Later while the server is reporting a build that
  // the running bundle has not yet caught up with. The key is namespaced to
  // keep it easy to clear during local debugging.
  static readonly DISMISSED_KEY = "codex.update.dismissedVersion";

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
        const dismissed = this.readDismissedVersion();
        if (dismissed !== body.application) {
          this.available.set({ version: body.application, commit: body.commit ?? null });
        }
      } else if (body.application && body.application === BUNDLE_VERSION) {
        // The bundle has caught up with the server, so forget any prior
        // dismissal: a future deploy should be allowed to notify again.
        this.clearDismissedVersion();
        if (this.available()) this.available.set(null);
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
  dismiss(): void {
    const current = this.available();
    if (current) this.writeDismissedVersion(current.version);
    this.available.set(null);
  }

  /** Read the last version the user dismissed without reloading. */
  private readDismissedVersion(): string | null {
    if (typeof localStorage === "undefined") return null;
    try {
      return localStorage.getItem(UpdateService.DISMISSED_KEY);
    } catch {
      return null;
    }
  }

  /** Persist the version the user dismissed so polling does not resurface the same banner. */
  private writeDismissedVersion(version: string): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(UpdateService.DISMISSED_KEY, version);
    } catch {
      // Storage may be disabled (private mode, quota, etc.); silently ignore
      // so the banner still hides for the rest of the session.
    }
  }

  /** Clear any dismissed-version marker; used once the bundle catches up with the server. */
  private clearDismissedVersion(): void {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.removeItem(UpdateService.DISMISSED_KEY);
    } catch {
      // ignore
    }
  }
}
