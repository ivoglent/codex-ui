import { bootstrapApplication } from "@angular/platform-browser";
import { provideServiceWorker } from "@angular/service-worker";
import { AppComponent } from "./app/app.component";
bootstrapApplication(AppComponent, { providers: [provideServiceWorker("ngsw-worker.js", { enabled: !location.hostname.includes("localhost"), registrationStrategy: "registerWhenStable:30000" })] }).catch(console.error);
