const { test, expect } = require("@playwright/test");

const appUrl = process.env.BUILDER_UI_URL ?? "http://127.0.0.1:5273";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "compact", width: 390, height: 844 },
];
const themes = ["light", "dark"];
const inspectorTabs = ["Editar", "Arquivos", "Validação", "JSON", "Artefato", "Runtime", "Studio"];

test.describe.configure({ mode: "serial" });

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`builder shell is usable in ${theme} theme at ${viewport.name}`, async ({ page }) => {
      const pageErrors = attachBrowserErrorCollector(page);

      await openBuilder(page, theme, viewport);

      await expectNoDocumentHorizontalOverflow(page);
      await expectTopbarControlsToFit(page);
      await page.keyboard.press("a");
      await expect(page.locator(".palette-item").first()).toBeFocused();
      await page.keyboard.press("f");

      for (const tabName of inspectorTabs) {
        const tab = page.locator(".tabs button", { hasText: tabName });
        await tab.scrollIntoViewIfNeeded();
        await tab.click();
        await expect(tab).toHaveClass(/active/);
        await expectNoDocumentHorizontalOverflow(page);
        await expectTopbarControlsToFit(page);
      }

      expect(pageErrors, `Unexpected browser errors in ${theme}/${viewport.name}`).toEqual([]);
    });
  }
}

for (const theme of themes) {
  test(`approval and Docker artifact render in ${theme} theme`, async ({ page }) => {
    const pageErrors = attachBrowserErrorCollector(page);

    await openBuilder(page, theme, viewports[0]);
    await generateApprovedDockerRuntime(page);

    await expect(page.getByText("API Docker final")).toBeVisible();
    await expect(page.getByText("Runtime URL")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Status$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Preparar \.env$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Build$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Up$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Smoke$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Down$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Dockerfile/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /docker-compose\.yml/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /\.agent-flow\/generated-meta\.json/ })).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", theme);

    await expectNoDocumentHorizontalOverflow(page);
    await expectTopbarControlsToFit(page);
    expect(pageErrors, `Unexpected browser errors in approved runtime ${theme}`).toEqual([]);
  });
}

function attachBrowserErrorCollector(page) {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      pageErrors.push(message.text());
    }
  });
  return pageErrors;
}

async function openBuilder(page, theme, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.addInitScript((selectedTheme) => {
    window.localStorage.setItem("agent-flow-builder.theme", selectedTheme);
  }, theme);
  await page.goto(appUrl);

  await expect(page.getByText("Agent Flow Builder")).toBeVisible();
  await expect(page.getByRole("button", { name: /Agente de Referência/ })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", theme);
}

async function generateApprovedDockerRuntime(page) {
  await page.getByRole("button", { name: /^LangGraph$/ }).click();
  await expect(page.getByRole("button", { name: /langgraph\.json/ })).toBeVisible({ timeout: 25_000 });

  await page.getByRole("button", { name: /^Aprovar$/ }).click();
  await expect(page.getByText("Aprovação: aprovada")).toBeVisible({ timeout: 15_000 });

  const dockerButton = page.getByRole("button", { name: /^API Docker$/ });
  await expect(dockerButton).toBeEnabled();
  await dockerButton.click();
  await expect(page.getByText("API Docker final")).toBeVisible({ timeout: 30_000 });
}

async function expectNoDocumentHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: Math.ceil(document.documentElement.scrollWidth),
    clientWidth: Math.ceil(document.documentElement.clientWidth),
    bodyScrollWidth: Math.ceil(document.body.scrollWidth),
    innerWidth: Math.ceil(window.innerWidth),
  }));
  expect(
    Math.max(metrics.scrollWidth, metrics.bodyScrollWidth),
    `Document overflow: ${JSON.stringify(metrics)}`,
  ).toBeLessThanOrEqual(metrics.innerWidth + 1);
}

async function expectTopbarControlsToFit(page) {
  const clipped = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".topbar .command-button, .topbar .icon-button, .tabs button"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && element.scrollWidth > Math.ceil(rect.width) + 1;
      })
      .map((element) => ({
        text: element.textContent.trim(),
        width: Math.ceil(element.getBoundingClientRect().width),
        scrollWidth: element.scrollWidth,
      })),
  );
  expect(clipped, "Topbar or tab button text is clipped").toEqual([]);
}
