import { bootstrapApplication } from "@angular/platform-browser";
import { provideServiceWorker, SwUpdate } from "@angular/service-worker";
import { AppComponent } from "./app/app.component";
import { AppUpdater, UpdateService } from "./app/update.service";
import { NotificationService } from "./app/notification.service";
import { installZoomGuard } from "./app/zoom-guard";
import { applyBranding, BRANDING, loadBranding } from "./app/branding";

const SW_CHECK_INTERVAL_MS = 15_000;

// Lock the PWA viewport before bootstrap so a tab that loads straight from a
// manifest shortcut never sees a zoomable flash.
installZoomGuard();

void loadBranding().then((branding) => {
  applyBranding(branding);
  return bootstrapApplication(AppComponent, { providers: [{ provide: BRANDING, useValue: branding }, provideServiceWorker("sw.js", { enabled: !location.hostname.includes("localhost"), registrationStrategy: "registerImmediately" })] }).then((application) => ({ application, branding }));
})
  .then(({ application, branding }) => {
    application.injector.get(UpdateService).setBrandTitle(branding.title);
    application.injector.get(NotificationService).setBrandTitle(branding.title);
    const updates = application.injector.get(SwUpdate, null);
    // Wire the service-worker controller into UpdateService. The adapter
    // exposes only the surface the service needs so the rest of the app
    // stays decoupled from `@angular/service-worker`.
    application.injector.get(UpdateService).bind(updates ? {
      isEnabled: updates.isEnabled,
      versionUpdates: updates.versionUpdates as unknown as AppUpdater["versionUpdates"],
      activateUpdate: () => updates.activateUpdate(),
    } : null);
    if (!updates || !updates.isEnabled) return;
    const triggerCheck = () => { void updates.checkForUpdate().catch(() => undefined); };
    void triggerCheck();
    setInterval(triggerCheck, SW_CHECK_INTERVAL_MS);
    addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") triggerCheck(); });
    addEventListener("focus", triggerCheck);
    addEventListener("online", triggerCheck);
  })
  .catch(console.error);
