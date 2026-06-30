const { test, expect } = require("@playwright/test");

const appUrl = process.env.BUILDER_UI_URL ?? "http://127.0.0.1:5273";
const apiUrl = process.env.BUILDER_API_URL ?? "http://127.0.0.1:3433";
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
  test(`studio runs with data render in ${theme} theme`, async ({ page, request }) => {
    const pageErrors = attachBrowserErrorCollector(page);
    await seedStudioRuns(request);

    await openBuilder(page, theme, viewports[0]);
    await openInspectorTab(page, "Studio");

    await expect(page.getByText("Runs locais")).toBeVisible();
    await expect(page.getByRole("button", { name: /ui-audit-error/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /ui-audit-ok/ })).toBeVisible();

    await page.getByRole("button", { name: /ui-audit-error/ }).click();
    await expect(page.getByRole("button", { name: /#3\s+node_failed/ })).toBeVisible();
    await expect(page.getByText("input_safety_check").first()).toBeVisible();
    await expect(page.getByText("Cadeia causal")).toBeVisible();
    await expect(page.getByText("com falha")).toBeVisible();
    await expect(page.getByText("Impactados")).toBeVisible();
    await expect(page.getByText("llm_step").first()).toBeVisible();
    await expect(page.getByText("State inspector")).toBeVisible();
    await expect(page.getByText("Conteúdo inválido para este fluxo.", { exact: true })).toBeVisible();
    await expect(page.getByText("blocked by safety gate").first()).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", theme);

    await page.getByRole("button", { name: /ui-audit-ok/ }).click();
    await page.getByRole("button", { name: /#4\s+llm_completed/ }).click();
    const promptSection = page.locator(".node-context-section", { hasText: "Prompt renderizado" });
    await expect(promptSection).toBeVisible();
    await expect(promptSection.getByText("prompts/system.md", { exact: true })).toBeVisible();
    await expect(promptSection.getByText(/Aumentar conversões em onboarding\./)).toBeVisible();
    const metricsSection = page.locator(".node-context-section", { hasText: "Métricas do nó" });
    await expect(metricsSection).toBeVisible();
    await expect(metricsSection.getByText("total_tokens", { exact: true })).toBeVisible();
    await expect(metricsSection.getByText("168", { exact: true })).toBeVisible();
    await expect(metricsSection.getByText("total_usd", { exact: true })).toBeVisible();
    await expect(metricsSection.getByText("$0.002400", { exact: true })).toBeVisible();
    const spansSection = page.locator(".node-context-section", { hasText: "Spans estruturados" });
    await expect(spansSection).toBeVisible();
    await expect(spansSection.getByText("llm_call", { exact: true })).toBeVisible();
    await expect(spansSection.getByText("168 tokens")).toBeVisible();
    await page.getByRole("button", { name: /^Criar fork$/ }).click();
    await expect(page.getByText("Fork criado a partir do evento #4.")).toBeVisible();
    const scenarioSection = page.locator(".sandbox-section", { hasText: "Cenários de teste" });
    const selectedScenarioCard = scenarioSection.locator(".runtime-item", { hasText: "Fork llm_step #4" });
    await expect(selectedScenarioCard.getByText("Fork llm_step #4", { exact: true })).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Fork de checkpoint: .*#4.*llm_step/)).toBeVisible();
    await expect(page.locator(".turn-input")).toHaveValue("Aumentar conversões em onboarding.");

    await expectNoDocumentHorizontalOverflow(page);
    await expectTopbarControlsToFit(page);
    expect(pageErrors, `Unexpected browser errors in studio runs ${theme}`).toEqual([]);
  });
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

test("Docker operations render loading, running, stopped and error states", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await openBuilder(page, "dark", viewports[0]);
  await generateApprovedDockerRuntime(page);
  await page.getByLabel("Runtime URL").fill("http://127.0.0.1:48999");

  await page.getByRole("button", { name: /^Preparar \.env$/ }).click();
  await expect(page.getByText(".env encontrado")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /^Build$/ }).click();
  await expect(page.getByRole("button", { name: /^Cancelar$/ })).toBeEnabled({ timeout: 3_000 });
  await expect(page.getByText("executando").first()).toBeVisible();
  await expect(page.getByText("Progresso do build")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: /^Cancelar$/ })).toBeDisabled({ timeout: 15_000 });
  await expect(page.getByText("Build Docker final concluido.").first()).toBeVisible();

  await page.getByRole("button", { name: /^Up$/ }).click();
  await expect(page.getByText("Container Docker final iniciado.").first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: /^Inspecionar$/ }).click();
  await expect(page.locator(".docker-service-row", { hasText: "api" }).getByText("running")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Application startup complete.")).toBeVisible();

  await page.getByRole("button", { name: /^Smoke$/ }).click();
  await expect(page.getByText(/Smoke test falhou/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("erro").first()).toBeVisible();

  await page.getByRole("button", { name: /^Down$/ }).click();
  await expect(page.getByText("Container Docker final parado.").first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /^Inspecionar$/ }).click();
  await expect(page.locator(".docker-service-row", { hasText: "api" }).getByText("exited")).toBeVisible({ timeout: 10_000 });

  await expectNoDocumentHorizontalOverflow(page);
  await expectTopbarControlsToFit(page);
  expect(pageErrors, "Unexpected browser errors in Docker operation states").toEqual([]);
});

test("outdated approval blocks Docker generation", async ({ page, request }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await seedApprovedSandbox(request);
  await mutateFlowVersion(request, "0.1.0-ui-audit-outdated");
  await openBuilder(page, "light", viewports[0]);

  await expect(page.getByText("Aprovação: desatualizada")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^API Docker$/ })).toBeDisabled();
  await expectNoDocumentHorizontalOverflow(page);
  await expectTopbarControlsToFit(page);
  expect(pageErrors, "Unexpected browser errors in outdated approval state").toEqual([]);
});

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

async function openInspectorTab(page, tabName) {
  const tab = page.locator(".tabs button", { hasText: tabName });
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(tab).toHaveClass(/active/);
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

async function seedStudioRuns(request) {
  const runs = [
    {
      runtimeUrl: "http://127.0.0.1:8090",
      resourceName: "sessions",
      session: {
        session_id: "ui-audit-ok",
        status: "completed",
        phase: "completed",
        turn: 2,
        max_turns: 3,
        metadata: { source: "ui-theme-audit", scenario: "success" },
        is_complete: true,
      },
      transcript: [
        { seq: 1, role: "assistant", code: "QUESTION", content: "Qual objetivo devemos investigar?", metadata: {} },
        { seq: 2, role: "user", content: "Aumentar conversões em onboarding.", metadata: {} },
        { seq: 3, role: "assistant", code: "DONE", content: "Plano gerado com próximos passos.", metadata: {} },
      ],
      events: [
        { seq: 1, event_type: "session_started", node: "start", payload: { turn: 0, status: "running", phase: "created" } },
        { seq: 2, event_type: "node_completed", node: "start_node", payload: { turn: 0, status: "ok", phase: "routing", custom: { next: "input_safety_check" } } },
        { seq: 3, event_type: "node_completed", node: "input_safety_check", payload: { turn: 1, status: "ok", phase: "safety", safety: { blocked: false } } },
        {
          seq: 4,
          event_type: "llm_completed",
          node: "llm_step",
          payload: {
            turn: 1,
            status: "ok",
            phase: "generation",
            durationMs: 812,
            usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
            cost: { total_usd: 0.0024 },
            llm: { adapter: "openai", model: "gpt-4.1-mini" },
            custom: { answer: "Pergunta gerada", output: { assistant_message: "Pergunta gerada" } },
            spans: [
              { name: "prompt_render", status: "ok", durationMs: 12 },
              { name: "llm_call", status: "ok", durationMs: 800, tokens: 168, costUsd: 0.0024 },
            ],
          },
        },
        { seq: 5, event_type: "node_completed", node: "output_safety_check", payload: { turn: 1, status: "ok", phase: "safety", safety: { blocked: false } } },
        { seq: 6, event_type: "node_completed", node: "deterministic_gate", payload: { turn: 2, status: "ok", phase: "completed", custom: { approved: true } } },
      ],
      logs: ["runtime ready", "success path completed"],
    },
    {
      runtimeUrl: "http://127.0.0.1:8090",
      resourceName: "sessions",
      session: {
        session_id: "ui-audit-error",
        status: "error",
        phase: "finalizing",
        turn: 1,
        max_turns: 3,
        metadata: { source: "ui-theme-audit", scenario: "safety-error" },
        is_complete: true,
      },
      transcript: [
        { seq: 1, role: "assistant", code: "QUESTION", content: "Qual conteúdo devemos avaliar?", metadata: {} },
        { seq: 2, role: "user", content: "Conteúdo inválido para este fluxo.", metadata: {} },
      ],
      events: [
        { seq: 1, event_type: "session_started", node: "start", payload: { turn: 0, status: "running", phase: "created" } },
        { seq: 2, event_type: "node_completed", node: "start_node", payload: { turn: 0, status: "ok", phase: "routing", custom: { next: "input_safety_check" } } },
        { seq: 3, event_type: "node_failed", node: "input_safety_check", payload: { turn: 1, status: "error", phase: "safety", safety: { blocked: true, reason: "blocked by safety gate" } } },
        { seq: 4, event_type: "node_started", node: "llm_step", payload: { turn: 1, status: "running", phase: "generation", custom: { blocked_reason: "blocked by safety gate" } } },
      ],
      logs: ["blocked by safety gate", "rollback scheduled"],
    },
  ];

  for (const run of runs) {
    const response = await request.post(`${apiUrl}/flows/reference-interview/studio-runs`, { data: run });
    await expectApiOk(response, `seed ${run.session.session_id}`);
  }
}

async function seedApprovedSandbox(request) {
  await expectApiOk(
    await request.post(`${apiUrl}/flows/reference-interview/generate-langgraph-sandbox`, {
      data: { outDir: "generated/reference-interview-langgraph-sandbox" },
    }),
    "generate LangGraph sandbox",
  );
  await expectApiOk(
    await request.post(`${apiUrl}/flows/reference-interview/approve-langgraph-sandbox`, {
      data: { outDir: "generated/reference-interview-langgraph-sandbox" },
    }),
    "approve LangGraph sandbox",
  );
}

async function mutateFlowVersion(request, version) {
  const response = await request.get(`${apiUrl}/flows/reference-interview`);
  await expectApiOk(response, "load flow before mutation");
  const payload = await response.json();
  const flow = { ...payload.flow, version };
  await expectApiOk(
    await request.put(`${apiUrl}/flows/reference-interview`, { data: flow }),
    "save mutated flow",
  );
}

async function expectApiOk(response, label) {
  if (response.ok()) {
    return;
  }
  throw new Error(`${label}: ${await response.text()}`);
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
