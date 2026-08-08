import { Component, computed, inject, signal } from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import type { ScheduleRecord, ScheduleStatus } from "./schedule.types";
import { ScheduleStore } from "./schedule.store";
import { ConnectionService } from "./connection.service";

interface ModelPairOption { key: string; label: string; model: string; modelProvider: string }

interface ScheduleFormState {
  prompt: string;
  cwd: string;
  runAtLocal: string;
  modelKey?: string;
  modelProvider?: string;
}

@Component({
  selector: "codex-schedule",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./schedule.component.html",
  styleUrl: "./schedule.component.css"
})
export class ScheduleComponent {
  private readonly store = inject(ScheduleStore);
  private readonly connection = inject(ConnectionService);
  readonly records = this.store.records;
  readonly loading = this.store.loading;
  readonly error = this.store.error;
  readonly pending = this.store.pending;
  readonly running = this.store.running;
  readonly history = this.store.history;
  readonly safeRoot = signal<string>("");

  readonly dialogOpen = signal(false);
  readonly editing = signal<ScheduleRecord | null>(null);
  readonly saving = signal(false);
  readonly dialogError = signal<string | null>(null);
  readonly form = signal<ScheduleFormState>(this.blankForm());

  readonly modelOptions = signal<ModelPairOption[]>([]);

  constructor() {
    void this.store.refresh();
    void this.loadModelOptions();
    void this.fetchSafeRoot();
  }

  private async fetchSafeRoot(): Promise<void> {
    try {
      const response = await fetch("/api/system/status");
      if (!response.ok) return;
      const body = await response.json().catch(() => ({}));
      const safeRoot = typeof body?.schedule?.safeRoot === "string" ? body.schedule.safeRoot : "";
      if (safeRoot) this.safeRoot.set(safeRoot);
    } catch { /* noop */ }
  }

  private async loadModelOptions(): Promise<void> {
    try {
      const response = await fetch("/api/model-presets");
      if (!response.ok) return;
      const body = await response.json().catch(() => ({}));
      const presets = Array.isArray(body?.presets) ? body.presets : [];
      const options: ModelPairOption[] = presets.flatMap((preset: any) => {
        if (!preset || typeof preset.model !== "string" || typeof preset.modelProvider !== "string") return [];
        return [{ key: `${preset.model}|${preset.modelProvider}`, label: `${preset.model} · ${preset.modelProvider}`, model: preset.model, modelProvider: preset.modelProvider }];
      });
      this.modelOptions.set(options);
    } catch { /* noop */ }
  }

  badgeClass(status: ScheduleStatus): string { return `status-badge status-${status}`; }

  promptPreview(schedule: ScheduleRecord): string {
    const trimmed = schedule.prompt.trim().replace(/\s+/g, " ");
    return trimmed.length > 80 ? `${trimmed.slice(0, 77)}…` : trimmed;
  }

  formatRunAt(iso: string | undefined): string {
    if (!iso) return "—";
    try {
      const date = new Date(iso);
      return date.toLocaleString();
    } catch { return iso; }
  }

  modelLabel(schedule: ScheduleRecord): string {
    if (!schedule.modelKey) return "ChatGPT (default)";
    return `${schedule.modelKey}${schedule.modelProvider ? " · " + schedule.modelProvider : ""}`;
  }

  openCreate(): void {
    this.editing.set(null);
    this.form.set(this.blankForm());
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  openEdit(schedule: ScheduleRecord): void {
    if (schedule.status !== "pending") return;
    this.editing.set(schedule);
    const local = this.toLocalInput(schedule.runAt);
    this.form.set({
      prompt: schedule.prompt,
      cwd: schedule.cwd,
      runAtLocal: local,
      modelKey: schedule.modelKey,
      modelProvider: schedule.modelProvider
    });
    this.dialogError.set(null);
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    if (this.saving()) return;
    this.dialogOpen.set(false);
    this.editing.set(null);
    this.form.set(this.blankForm());
    this.dialogError.set(null);
  }

  updateForm(patch: Partial<ScheduleFormState>): void {
    this.form.update((current) => ({ ...current, ...patch }));
  }

  onModelChange(value: string): void {
    if (!value) { this.updateForm({ modelKey: undefined, modelProvider: undefined }); return; }
    const match = this.modelOptions().find((option) => option.key === value);
    if (!match) { this.updateForm({ modelKey: undefined, modelProvider: undefined }); return; }
    this.updateForm({ modelKey: match.model, modelProvider: match.modelProvider });
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    const form = this.form();
    const prompt = form.prompt.trim();
    const cwd = form.cwd.trim();
    const runAt = form.runAtLocal ? this.fromLocalInput(form.runAtLocal) : "";
    if (!prompt || !cwd || !runAt) { this.dialogError.set("All fields are required."); return; }
    this.saving.set(true);
    this.dialogError.set(null);
    try {
      const editing = this.editing();
      if (editing) {
        await this.store.update(editing.id, { prompt, cwd, runAt, modelKey: form.modelKey, modelProvider: form.modelProvider });
      } else {
        await this.store.create({ prompt, cwd, runAt, modelKey: form.modelKey, modelProvider: form.modelProvider });
      }
      this.dialogOpen.set(false);
      this.editing.set(null);
      this.form.set(this.blankForm());
    } catch (error) {
      this.dialogError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.saving.set(false);
    }
  }

  async run(id: string): Promise<void> {
    try { await this.store.run(id); }
    catch (error) { this.store.setError({ code: "RUN_FAILED", message: error instanceof Error ? error.message : String(error) }); }
  }

  async cancel(id: string): Promise<void> {
    try { await this.store.cancel(id); }
    catch (error) { this.store.setError({ code: "CANCEL_FAILED", message: error instanceof Error ? error.message : String(error) }); }
  }

  async remove(schedule: ScheduleRecord): Promise<void> {
    if (!confirm(`Delete schedule "${this.promptPreview(schedule)}"?`)) return;
    try { await this.store.remove(schedule.id); }
    catch (error) { this.store.setError({ code: "DELETE_FAILED", message: error instanceof Error ? error.message : String(error) }); }
  }

  private blankForm(): ScheduleFormState {
    return { prompt: "", cwd: "", runAtLocal: this.defaultLocalRunAt() };
  }

  private defaultLocalRunAt(): string {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    return this.toLocalInput(now.toISOString());
  }

  private toLocalInput(iso: string): string {
    const date = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private fromLocalInput(local: string): string {
    const date = new Date(local);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  }
}
