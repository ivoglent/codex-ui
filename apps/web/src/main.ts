import { bootstrapApplication } from "@angular/platform-browser";
import { provideServiceWorker, SwUpdate } from "@angular/service-worker";
import { filter } from "rxjs";
import { AppComponent } from "./app/app.component";

const SW_CHECK_INTERVAL_MS = 15_000;

bootstrapApplication(AppComponent, { providers: [provideServiceWorker("ngsw-worker.js", { enabled: !location.hostname.includes("localhost"), registrationStrategy: "registerImmediately" })] })
  .then((application) => {
    const updates = application.injector.get(SwUpdate);
    if (!updates.isEnabled) return;
    const triggerCheck = () => { void updates.checkForUpdate().catch(() => undefined); };
    const activate = () => { void updates.activateUpdate().then(() => location.reload()).catch(() => location.reload()); };
    updates.versionUpdates.pipe(filter((event) => event.type === "VERSION_READY")).subscribe(activate);
    void triggerCheck();
    setInterval(triggerCheck, SW_CHECK_INTERVAL_MS);
    addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") triggerCheck(); });
    addEventListener("focus", triggerCheck);
    addEventListener("online", triggerCheck);
  })
  .catch(console.error);
