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
  await expect(page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button")).toHaveText([/Chat/, /Schedule/, /Settings/]);
  for (const administrationLabel of ["Work", "Approvals", "Activity", "More"]) {
    await expect(page.getByRole("button", { name: administrationLabel, exact: true })).toHaveCount(0);
  }
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe("standalone");
});

test("desktop navigation stays in the session rail and the send control is fully visible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only layout assertion");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await chooseProject(page);
  await chooseSession(page, /Fix CI failures/);
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  const send = page.getByRole("button", { name: "Send message" });
  const chatPane = page.locator(".chat-pane");
  const [navBox, sendBox, chatPaneBox] = await Promise.all([nav.boundingBox(), send.boundingBox(), chatPane.boundingBox()]);
  expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(900);
  expect(navBox!.y).toBeGreaterThan(800);
  expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(chatPaneBox!.x);
  expect(sendBox!.x).toBeGreaterThanOrEqual(0);
  expect(sendBox!.y).toBeGreaterThanOrEqual(0);
  expect(sendBox!.x + sendBox!.width).toBeLessThanOrEqual(1440);
  expect(sendBox!.x).toBeGreaterThanOrEqual(chatPaneBox!.x);
  expect(sendBox!.y + sendBox!.height).toBeLessThanOrEqual(chatPaneBox!.y + chatPaneBox!.height);
  await page.locator(".composer textarea").fill("desktop send control is reachable");
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.locator(".user-bubble").filter({ hasText: "desktop send control is reachable" })).toBeVisible();
});

test("pasting an image attaches it to a chat message", async ({ page }) => {
  await page.goto("/");
  await chooseProject(page);
  await chooseSession(page, /Fix CI failures/);
  const textarea = page.locator(".composer textarea");
  await textarea.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.items.add(new File([new Uint8Array([137, 80, 78, 71])], "pasted.png", { type: "image/png" }));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: clipboard });
    element.dispatchEvent(event);
  });
  const pasted = page.getByLabel("Pasted images").getByRole("img", { name: "pasted.png" });
  await expect(pasted).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByLabel("Pasted images")).toHaveCount(0);
  await expect(page.locator(".user-message").last().getByRole("img", { name: "Pasted image" })).toBeVisible();
});

test("selecting a local image attaches it to a chat message", async ({ page }) => {
  await page.goto("/");
  await chooseProject(page);
  await chooseSession(page, /Fix CI failures/);
  await page.locator("input[type=file]").setInputFiles({ name: "local.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
  await expect(page.getByLabel("Pasted images").getByRole("img", { name: "local.png" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByLabel("Pasted images")).toHaveCount(0);
  await expect(page.locator(".user-message").last().getByRole("img", { name: "Pasted image" })).toBeVisible();
});

test("desktop keeps the composer at the bottom when no session header is rendered", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only layout assertion");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator(".session-bar").evaluate((element) => element.remove());
  const [composerBox, textareaBox, chatBox] = await Promise.all([
    page.locator(".composer").boundingBox(),
    page.locator(".composer textarea").boundingBox(),
    page.locator(".chat-pane").boundingBox()
  ]);
  expect(composerBox!.height).toBeLessThan(180);
  expect(textareaBox!.y + textareaBox!.height).toBeLessThanOrEqual(chatBox!.y + chatBox!.height);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(chatBox!.y + chatBox!.height);
  expect(composerBox!.y + composerBox!.height).toBeGreaterThan(chatBox!.y + chatBox!.height - 10);
});

test("desktop keeps bottom controls visible when the shell height changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only layout assertion");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator(".app-shell").evaluate((element) => element.style.setProperty("height", "700px"));
  const bounds = await page.evaluate(() => Object.fromEntries([".app-shell", ".bottom-nav", ".composer", ".composer-box"].map((selector) => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    return [selector, { top: rect.top, bottom: rect.bottom, height: rect.height }];
  })));
  expect(bounds[".app-shell"].height).toBe(700);
  expect(bounds[".bottom-nav"].bottom).toBeLessThanOrEqual(700);
  expect(bounds[".composer-box"].bottom).toBeLessThanOrEqual(700);
  expect(bounds[".composer"].top).toBeGreaterThan(400);
});

test("desktop keeps navigation and the composer inside a short viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop-only layout assertion");
  await page.setViewportSize({ width: 1071, height: 374 });
  await page.goto("/");
  await chooseProject(page);
  await chooseSession(page, /Fix CI failures/);
  const [nav, composer, chatPane] = await Promise.all([
    page.getByRole("navigation", { name: "Primary navigation" }).boundingBox(),
    page.locator(".composer").boundingBox(),
    page.locator(".chat-pane").boundingBox()
  ]);
  expect(nav!.y + nav!.height).toBeLessThanOrEqual(374);
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(374);
  expect(composer!.x).toBeGreaterThanOrEqual(chatPane!.x);
  expect(nav!.x + nav!.width).toBeLessThanOrEqual(chatPane!.x);
  await expect(page.locator(".composer textarea")).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Create session or project" })).toBeVisible();
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

test("a parent workspace session stays out of child project filters", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.locator("#session-value").click();
  const sessionDialog = page.getByRole("dialog", { name: "Select session" });
  await expect(sessionDialog.getByRole("option", { name: /Shared workspace session/ })).toBeVisible();
  await sessionDialog.getByRole("button", { name: "Close selector" }).click();
  await expect(sessionDialog).toBeHidden();
  await chooseProject(page);
  await page.locator("#session-value").click();
  await expect(page.getByRole("option", { name: /Fix CI failures/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Shared workspace session/ })).toHaveCount(0);
});

test("Schedule and Settings keep diagnostics out of the chat", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Schedule/ }).click();
  await expect(page.getByRole("heading", { name: "Scheduled tasks" })).toBeVisible();
  await expect(page.getByText("No scheduled tasks.")).toBeVisible();
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
  await expect(page.getByText(/Historical Codex update 34\./)).toBeVisible();
  const timeline = page.getByLabel("Session conversation");
  await expect.poll(() => timeline.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(120);
  await timeline.evaluate((element) => { element.dispatchEvent(new WheelEvent("wheel")); element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
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
  await expect(page.getByText(/Historical Codex update 34\./)).toBeVisible();
  const chat = page.getByTestId("chat-scroller"), button = page.getByRole("button", { name: "Scroll to latest message" });
  await expect.poll(() => chat.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(120);
  await chat.evaluate((element) => { element.dispatchEvent(new WheelEvent("wheel")); element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  await expect(button).toBeVisible();
  const before = await chat.evaluate((element) => element.scrollTop);
  await page.waitForTimeout(250);
  expect(await chat.evaluate((element) => element.scrollTop)).toBe(before);
  const oldButtonRect = await button.boundingBox();
  const textarea = page.locator(".composer textarea");
  await textarea.fill("one\ntwo\nthree\nfour\nfive\nsix");
  const newButtonRect = await button.boundingBox();
  expect(newButtonRect!.y).toBeLessThan(oldButtonRect!.y);
  await button.click();
  await expect(button).toBeHidden();
  expect(await chat.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(120);

  await chat.evaluate((element) => { element.dispatchEvent(new WheelEvent("wheel")); element.scrollTop = 420; element.dispatchEvent(new Event("scroll")); });
  await chooseSession(page, /Terminal approves command/); await page.waitForTimeout(650);
  await chooseSession(page, /Fix CI failures/);
  await expect.poll(() => chat.evaluate((element) => element.scrollTop)).toBeGreaterThan(300);

  await page.reload();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.locator("#session-value")).toHaveText("Fix CI failures");
  await expect.poll(() => chat.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(120);
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
  await expect(page.getByLabel("Model and provider")).toBeVisible();
  const menuRect = await page.getByRole("menu").boundingBox();
  expect(menuRect!.x).toBeGreaterThanOrEqual(0);
  expect(menuRect!.x + menuRect!.width).toBeLessThanOrEqual(390);
  await page.getByLabel("Reasoning effort").selectOption("high");
  await page.getByLabel("Execution profile").selectOption("safe");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
});

test("selects a configured model for a new session and switches subsequent messages", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await chooseProject(page);
  await page.getByRole("button", { name: "Create session or project" }).click();
  await page.getByRole("menuitem", { name: /New session/ }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a model" });
  await expect(dialog).toBeVisible();
  const rect = await dialog.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  const newSessionModels = dialog.getByRole("listbox", { name: "Model and provider" });
  await expect(newSessionModels.getByRole("option", { name: "ChatGPT" })).toBeVisible();
  const minimax = newSessionModels.getByRole("option", { name: "MiniMax-M3 · minimax" });
  await expect(minimax).toBeVisible();
  await minimax.click();
  await expect(minimax).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect(dialog).toBeHidden();

  const composerOptions = page.getByRole("button", { name: "Composer options" });
  await composerOptions.click();
  const activeModel = page.getByLabel("Model and provider");
  await expect(activeModel).toHaveValue('["minimax","MiniMax-M3"]');
  const composer = page.locator(".composer textarea");
  await composer.fill("Keep this draft while switching models");
  await activeModel.selectOption({ label: "Fake ChatGPT" });
  await expect(activeModel).toHaveValue('["openai","fake-model"]');
  await expect(composer).toHaveValue("Keep this draft while switching models");

  await activeModel.selectOption({ label: "Unavailable · offline" });
  await expect(page.getByText("Selected provider is unavailable")).toBeVisible();
  await expect(activeModel).toHaveValue('["openai","fake-model"]');

  await page.reload();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Composer options" }).click();
  await expect(page.getByLabel("Model and provider")).toHaveValue('["openai","fake-model"]');
});

test("creates a safe project with a Project setup session and README task", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  const name = `Mobile ${testInfo.project.name} Project`;
  await page.getByRole("button", { name: "Create session or project" }).click();
  const createMenu = page.getByRole("menu");
  await expect(createMenu.getByRole("menuitem", { name: /New session/ })).toBeDisabled();
  await createMenu.getByRole("menuitem", { name: /New project/ }).click();
  const dialog = page.getByRole("dialog", { name: "Create a project" });
  await expect(dialog).toBeVisible();
  const rect = await dialog.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  await dialog.getByLabel("Project name").fill(name);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#project-value")).toHaveText(name);
  await expect(page.locator("#session-value")).toHaveText("Project setup");
  await expect(page.getByText(/Initialize this project by creating a README\.md/)).toBeVisible();
});

test("Enter keeps composing multiline text and only the Send button submits", async ({ page }, testInfo) => {
  await page.goto("/");
  await chooseProject(page);
  await chooseSession(page, /Fix CI failures/);
  const textarea = page.locator(".composer textarea");
  const firstLine = `first line ${testInfo.project.name}`;
  await textarea.fill(`${firstLine}\nsecond line`);
  await textarea.press("Enter");
  await expect(textarea).toHaveValue(`${firstLine}\nsecond line\n`);
  await expect(page.getByText(firstLine, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^(Send message|Steer Codex)$/ }).click();
  await expect(textarea).toHaveValue("");
  await expect(page.getByText(firstLine, { exact: true })).toBeVisible();
});

test("offline chat preserves its draft and disables sending until reconnect", async ({ page, context }) => {
  await page.goto("/");
  await chooseProject(page);
  await chooseSession(page, /Fix CI failures/);
  const textarea = page.locator(".composer textarea");
  await textarea.fill("Keep this offline draft");
  await context.setOffline(true);
  await expect(page.getByText("Chat is offline.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Send message|Steer Codex)$/ })).toBeDisabled();
  await expect(textarea).toHaveValue("Keep this offline draft");
  await context.setOffline(false);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /^(Send message|Steer Codex)$/ })).toBeEnabled();
  await expect(textarea).toHaveValue("Keep this offline draft");
});

test("streaming growth and composer resizing retain bottom-following intent", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await chooseProject(page);
  await chooseSession(page, /Fix CI failures/);
  const chat = page.getByTestId("chat-scroller");
  await page.waitForTimeout(650);
  await chat.evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event("scroll")); });
  await expect.poll(() => chat.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(120);
  await page.locator(".composer textarea").fill("one\ntwo\nthree\nfour\nfive\nsix");
  await expect.poll(() => chat.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(120);
  await page.locator(".messages").evaluate((messages) => { const growth = document.createElement("div"); growth.dataset["testGrowth"] = "true"; growth.style.height = "640px"; messages.append(growth); });
  await expect.poll(() => chat.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(120);
});
