import { expect, test } from "@playwright/test";

test("main screen is a focused Codex chat workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Codex Control");
  await expect(page.locator(".app-header")).toBeVisible();
  await expect(page.locator(".session-rail")).toBeVisible();
  await expect(page.locator(".timeline")).toBeVisible();
  await expect(page.locator(".composer")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button")).toHaveText([/Chat/, /Inbox/, /Settings/]);
  for (const administrationLabel of ["Work", "Approvals", "Activity", "More"]) {
    await expect(page.getByRole("button", { name: administrationLabel, exact: true })).toHaveCount(0);
  }
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe("standalone");
});

test("project and session selection render useful persisted chat", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByLabel("Session scope", { exact: true }).selectOption("codex-ui");
  await expect(page.getByRole("option", { name: /Fix CI failures/ })).toBeAttached();
  await page.getByLabel("Active session", { exact: true }).selectOption("thread-existing");
  await expect(page.getByText("Please fix the failing CI tests", { exact: true })).toBeVisible();
  await expect(page.getByText("I found the failing workflow and corrected the build configuration.", { exact: true })).toBeVisible();
  await expect(page.locator(".command-card summary b").filter({ hasText: "pnpm test" })).toBeVisible();
  await expect(page.getByText("item/completed", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Message composer")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create new session" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open project in code-server" })).toBeVisible();
  const timeline = page.getByLabel("Session conversation");
  expect(await timeline.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  const codexMessages = page.locator(".codex-message");
  expect(await codexMessages.evaluateAll((messages) => messages.every((message) => {
    const avatar = message.querySelector<HTMLElement>(".codex-avatar");
    const content = message.querySelector<HTMLElement>(".message-content");
    if (!avatar || !content) return false;
    const messageBox = message.getBoundingClientRect();
    const avatarBox = avatar.getBoundingClientRect();
    const contentBox = content.getBoundingClientRect();
    return avatarBox.bottom <= contentBox.top + 0.5
      && contentBox.left >= messageBox.left - 0.5
      && contentBox.right <= messageBox.right + 0.5
      && content.scrollWidth <= content.clientWidth;
  }))).toBeTruthy();
});

test("Inbox and Settings keep diagnostics out of the chat", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Inbox/ }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByText("No approvals waiting.")).toBeVisible();
  await page.getByRole("button", { name: /Settings/ }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("Advanced diagnostics")).toBeVisible();
  await expect(page.locator(".advanced")).not.toHaveAttribute("open", "");
});

test("mobile chat owns scrolling and exposes Scroll to latest", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Session scope", { exact: true }).selectOption("codex-ui");
  await page.getByLabel("Active session", { exact: true }).selectOption("thread-existing");
  const timeline = page.getByLabel("Session conversation");
  await timeline.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  await expect(page.getByRole("button", { name: "Scroll to latest message" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  expect(await timeline.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await page.getByRole("button", { name: "Scroll to latest message" }).click();
  await expect(page.getByRole("button", { name: "Scroll to latest message" })).toBeHidden();
});
