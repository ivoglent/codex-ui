import { expect, test } from "@playwright/test";

test("main screen is a focused four-area chat workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Codex Control");
  await expect(page.locator(".app-header")).toBeVisible();
  await expect(page.locator(".workspace-selectors")).toBeVisible();
  await expect(page.locator(".chat-conversation")).toBeVisible();
  await expect(page.locator(".message-composer")).toBeVisible();
  await expect(page.locator("nav")).toHaveCount(0);
  for (const administrationLabel of ["Work", "Approvals", "Activity", "More", "Archive", "Delete"]) {
    await expect(page.getByRole("button", { name: administrationLabel, exact: true })).toHaveCount(0);
  }
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe("standalone");
});

test("project and session selection render useful persisted chat", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("connected", { exact: true })).toBeVisible();
  await page.getByLabel("Project").selectOption("codex-ui");
  await expect(page.getByRole("option", { name: "Fix CI failures" })).toBeAttached();
  await page.getByLabel("Active session").selectOption("thread-existing");
  await expect(page.getByText("Please fix the failing CI tests", { exact: true })).toBeVisible();
  await expect(page.getByText("I found the failing workflow and corrected the build configuration.", { exact: true })).toBeVisible();
  await expect(page.getByText("pnpm test", { exact: true })).toBeVisible();
  await expect(page.getByText("item/completed", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Message composer")).toBeVisible();
});
