import { expect, test } from "@playwright/test";

async function chooseProject(page: any, label = /Codex Control PWA/) {
  await page.locator("#project-value").click();
  await expect(page.getByRole("dialog", { name: "Select project" })).toBeVisible();
  await page.getByRole("option", { name: label }).click();
}

async function chooseSession(page: any, label: string | RegExp) {
  await page.locator("#session-value").click();
  await expect(page.getByRole("dialog", { name: "Select session" })).toBeVisible();
  await page.getByRole("option", { name: label }).click();
}

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
  await chooseProject(page);
  await chooseSession(page, /Fix CI failures/);
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

test("a session in a nested working directory remains visible in its project", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.locator("#session-value")).toHaveText("Fix CI failures");
  await chooseProject(page);
  await page.locator("#session-value").click();
  await expect(page.getByRole("option", { name: /Fix CI failures/ })).toBeVisible();
  await page.getByRole("option", { name: /Fix CI failures/ }).click();
  await expect(page.getByText("Please fix the failing CI tests", { exact: true })).toBeVisible();
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
test("approval is a session-scoped popup and disappears after a UI decision", async ({ page }) => {
  await page.goto("/");
  await chooseProject(page);
  await chooseSession(page, /Approve a command/);
  const dialog = page.getByRole("dialog", { name: "Approval required" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Run the requested command")).toBeVisible();
  await dialog.getByRole("button", { name: "Approve session" }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(700);
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Approved", { exact: true })).toHaveCount(0);
});

test("terminal approval closes the popup for the same session", async ({ page }) => {
  await page.goto("/");
  await chooseProject(page);
  await chooseSession(page, /Terminal approves command/);
  const dialog = page.getByRole("dialog", { name: "Approval required" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden({ timeout: 2_000 });
  await expect(page.getByText("Approved", { exact: true })).toHaveCount(0);
});


test("mobile chat owns scrolling and exposes Scroll to latest", async ({ page }) => {
  await page.goto("/");
  await chooseProject(page);
  await chooseSession(page, /Fix CI failures/);
  const timeline = page.getByLabel("Session conversation");
  await timeline.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  await expect(page.getByRole("button", { name: "Scroll to latest message" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  expect(await timeline.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await page.getByRole("button", { name: "Scroll to latest message" }).click();
  await expect(page.getByRole("button", { name: "Scroll to latest message" })).toBeHidden();
});

for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }]) {
  test(`mobile width containment and balanced padding at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await chooseProject(page);
    await chooseSession(page, /Fix CI failures/);
    await expect(page.getByText("Width regression fixture")).toBeVisible();

    const metrics = await page.evaluate(() => {
      const chat = document.querySelector<HTMLElement>('[data-testid="chat-scroller"]')!;
      const timeline = document.querySelector<HTMLElement>('[data-testid="chat-timeline"]')!;
      const style = getComputedStyle(timeline), rect = timeline.getBoundingClientRect();
      const leftBoundary = rect.left + Number.parseFloat(style.paddingLeft);
      const rightBoundary = rect.right - Number.parseFloat(style.paddingRight);
      const intentional = "pre, pre *, .table-scroll, .table-scroll *";
      const offenders = [...timeline.querySelectorAll<HTMLElement>("*")].filter((element) => !element.matches(intentional)).filter((element) => {
        const child = element.getBoundingClientRect(); return child.left < leftBoundary - 1 || child.right > rightBoundary + 1;
      }).map((element) => ({ tag: element.tagName, className: String(element.className), text: element.textContent?.slice(0, 80) }));
      return {
        document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight },
        chat: { clientWidth: chat.clientWidth, scrollWidth: chat.scrollWidth, scrollHeight: chat.scrollHeight, clientHeight: chat.clientHeight, overflowY: getComputedStyle(chat).overflowY },
        timeline: { paddingLeft: Number.parseFloat(style.paddingLeft), paddingRight: Number.parseFloat(style.paddingRight) }, offenders,
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    });
    expect(metrics.document.scrollWidth).toBeLessThanOrEqual(metrics.document.clientWidth);
    expect(metrics.document.scrollHeight).toBeLessThanOrEqual(metrics.document.clientHeight);
    expect(metrics.chat.scrollWidth).toBeLessThanOrEqual(metrics.chat.clientWidth);
    expect(metrics.chat.scrollHeight).toBeGreaterThan(metrics.chat.clientHeight);
    expect(metrics.chat.overflowY).toBe("auto");
    expect(metrics.timeline.paddingLeft).toBeGreaterThanOrEqual(14);
    expect(metrics.timeline.paddingRight).toBeGreaterThanOrEqual(14);
    expect(metrics.offenders).toEqual([]);
    const pre = page.locator(".markdown pre").last();
    expect(await pre.evaluate((element) => element.scrollWidth > element.clientWidth)).toBeTruthy();
    const table = page.locator(".table-scroll").last();
    expect(await table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`chat-${viewport.width}x${viewport.height}.png`), fullPage: true });
  });
}

test("mobile custom selectors stay in the viewport, search, select, and restore focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const projectTrigger = page.locator("#project-value");
  await projectTrigger.click();
  const dialog = page.getByRole("dialog", { name: "Select project" });
  await expect(dialog.locator("select")).toHaveCount(0);
  const rect = await dialog.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390); expect(rect!.y + rect!.height).toBeLessThanOrEqual(844);
  await dialog.getByRole("textbox", { name: "Search projects" }).fill("trading-workers");
  await expect(dialog.getByRole("option", { name: /trading-workers/ })).toBeVisible();
  await dialog.getByRole("option", { name: /trading-workers/ }).click();
  await expect(projectTrigger).toHaveText("trading-workers");
  await expect(dialog).toBeHidden();
  await page.locator("#project-value").click();
  await expect(page.getByRole("dialog", { name: "Select project" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".selector-trigger").first()).toBeFocused();
  await expect(page.locator("select#project,select#session")).toHaveCount(0);
});

test("scroll state follows bottom, preserves older reading, resizes composer, and restores sessions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/"); await chooseProject(page); await chooseSession(page, /Fix CI failures/);
  const chat = page.getByTestId("chat-scroller"), button = page.getByRole("button", { name: "Scroll to latest message" });
  await chat.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  await expect(button).toBeVisible();
  const before = await chat.evaluate((element) => element.scrollTop);
  await page.waitForTimeout(250);
  expect(await chat.evaluate((element) => element.scrollTop)).toBe(before);
  const oldButtonRect = await button.boundingBox();
  const textarea = page.getByPlaceholder("Message Codex…");
  await textarea.fill("one\ntwo\nthree\nfour\nfive\nsix");
  const newButtonRect = await button.boundingBox();
  expect(newButtonRect!.y).toBeLessThan(oldButtonRect!.y);
  await button.click();
  await expect(button).toBeHidden();
  expect(await chat.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(120);

  await chat.evaluate((element) => { element.scrollTop = 420; element.dispatchEvent(new Event("scroll")); });
  await chooseSession(page, /Terminal approves command/); await page.waitForTimeout(650);
  await chooseSession(page, /Fix CI failures/);
  await expect.poll(() => chat.evaluate((element) => element.scrollTop)).toBeGreaterThan(300);
});

test("composer options are hidden behind the three-dot menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Composer options" });
  await expect(trigger).toBeVisible();
  await expect(page.getByLabel("Reasoning effort")).toBeHidden();
  await expect(page.getByLabel("Execution profile")).toBeHidden();
  await trigger.click();
  await expect(page.getByLabel("Reasoning effort")).toBeVisible();
  await expect(page.getByLabel("Execution profile")).toBeVisible();
  const menuRect = await page.getByRole("menu").boundingBox();
  expect(menuRect!.x).toBeGreaterThanOrEqual(0);
  expect(menuRect!.x + menuRect!.width).toBeLessThanOrEqual(390);
  await page.getByLabel("Reasoning effort").selectOption("high");
  await page.getByLabel("Execution profile").selectOption("safe");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
});
