import { bootstrapApplication } from "@angular/platform-browser";
import { provideServiceWorker, SwUpdate } from "@angular/service-worker";
import { filter } from "rxjs";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent, { providers: [provideServiceWorker("ngsw-worker.js", { enabled: !location.hostname.includes("localhost"), registrationStrategy: "registerImmediately" })] })
  .then((application) => {
    const updates = application.injector.get(SwUpdate);
    if (!updates.isEnabled) return;
    updates.versionUpdates.pipe(filter((event) => event.type === "VERSION_READY")).subscribe(() => location.reload());
    void updates.checkForUpdate();
    setInterval(() => void updates.checkForUpdate(), 60_000);
  })
  .catch(console.error);
