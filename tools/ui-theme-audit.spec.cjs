const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");

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

test("canvas finder searches, filters and focuses nodes", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "agent-flow-builder.studio-node-pins.reference-interview",
      JSON.stringify([
        {
          id: "pin-ui-audit-stale",
          nodeId: "input_safety_check",
          nodeType: "safety_gate",
          runId: "run-ui-audit-stale",
          sessionId: "session-ui-audit-stale",
          eventSeq: 3,
          eventType: "node_completed",
          nodeHash: "deadbeef",
          input: {},
          output: {},
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:00:00.000Z",
        },
      ]),
    );
  });
  await openBuilder(page, "light", viewports[0]);

  const safetyGroup = page.getByRole("button", { name: "Recolher grupo Safety" });
  await expect(safetyGroup).toBeVisible();
  await expect(safetyGroup).toContainText("2");
  await safetyGroup.click();
  await expect(page.getByRole("button", { name: "Expandir grupo Safety" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".react-flow__node", { hasText: "input_safety_check" })).toBeHidden();

  const searchInput = page.getByLabel("Buscar nós no canvas");
  const typeFilter = page.getByLabel("Filtrar nós por tipo");
  await searchInput.fill("safety");
  await expect(page.locator(".canvas-search-summary")).toHaveText("2/8");

  const inputSafetyChip = page.locator(".canvas-node-chip", { hasText: "input_safety_check" });
  await expect(inputSafetyChip).toBeVisible();
  await inputSafetyChip.click();
  await expect(page.getByRole("button", { name: "Recolher grupo Safety" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".react-flow__node.search-match")).toHaveCount(2);
  await expect(inputSafetyChip).toHaveClass(/selected/);
  await expect(page.locator(".react-flow__node.selected")).toContainText("input_safety_check");
  await expect(page.locator(".react-flow__node.stale-node.selected")).toContainText("input_safety_check");
  await expect(page.locator(".react-flow__edge.stale-edge")).not.toHaveCount(0);
  await page.locator(".right-panel").getByLabel("Descrição").fill("Checagem visual de entrada.");
  await expect(page.locator(".react-flow__node.dirty-node.selected")).toContainText("input_safety_check");

  await searchInput.fill("");
  await typeFilter.selectOption("llm_prompt");
  await expect(page.locator(".canvas-search-summary")).toHaveText("1/8");
  await expect(page.locator(".canvas-node-chip")).toContainText("llm_step");

  await page.getByRole("button", { name: "Limpar" }).click();
  await expect(searchInput).toHaveValue("");
  await expect(typeFilter).toHaveValue("");
  await expectNoDocumentHorizontalOverflow(page);
  expect(pageErrors, "Unexpected browser errors while using canvas finder").toEqual([]);
});

test("assets panel edits prompt and schema metadata visually", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await openBuilder(page, "light", viewports[0]);
  await openInspectorTab(page, "Arquivos");

  await page.getByLabel("Descrição do prompt").fill("Prompt principal para conduzir entrevista guiada.");
  await page.getByLabel("Tags do prompt").fill("entrevista, llm, principal");
  await page.getByLabel("Variáveis do prompt").fill("session_id, user_message, recent_messages, objetivo");
  await page.getByLabel("Versão do prompt").fill("v2");

  await page.getByLabel("Descrição do schema").fill("Estado público da sessão e saída estruturada.");
  await page.getByLabel("Tags do schema").fill("estado, contrato, sessão");
  await page.getByLabel("Versão do schema").fill("v2");
  await page.getByLabel("Descrição de session_id").fill("Identificador público da sessão.");
  await expect(page.getByLabel("Enum de status")).toHaveValue("created, active, completed");
  await page.getByLabel("Enum de status").fill("created, active, completed, archived");
  await expect(page.getByLabel("Tipo dos itens de recent_messages")).toHaveValue("object");
  await expect(page.getByLabel("recent_messages[].role obrigatório")).toBeChecked();
  await page.getByLabel("Descrição de recent_messages[].role").fill("Papel da mensagem no histórico.");
  await page.getByLabel("Nome da propriedade em recent_messages[]").fill("timestamp");
  await page.getByLabel("Tipo da nova propriedade em recent_messages[]").selectOption("string");
  await page.getByRole("button", { name: "Adicionar propriedade em recent_messages[]" }).click();
  await expect(page.locator(".schema-editor")).toHaveValue(/"timestamp"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"Papel da mensagem no histórico."/);
  await page.getByLabel("Tipo dos itens de recent_messages").selectOption("string");
  await page.getByLabel("user_message obrigatório").check();
  await page.getByLabel("Nova propriedade do schema").fill("review_score");
  await page.getByLabel("Tipo da nova propriedade").selectOption("number");
  await page.getByRole("button", { name: /^Adicionar$/ }).click();
  await expect(page.locator(".schema-editor")).toHaveValue(/"review_score"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"user_message"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"archived"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"items": \{\s+"type": "string"\s+\}/);
  await expect(page.locator(".schema-editor")).not.toHaveValue(/"timestamp"/);
  await page.getByRole("button", { name: /^Salvar schema$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Schema salvo em");

  await expect(page.getByText("workspace alterado").first()).toBeVisible();
  await page.getByRole("button", { name: /^Salvar metadados$/ }).first().click();
  await expect(page.locator("footer[role='status']")).toContainText("Workspace reference-interview salvo.");

  await openInspectorTab(page, "JSON");
  const preview = page.locator(".json-preview");
  await expect(preview).toContainText('"description": "Prompt principal para conduzir entrevista guiada."');
  await expect(preview).toContainText('"tags": [');
  await expect(preview).toContainText('"objetivo"');
  await expect(preview).toContainText('"description": "Estado público da sessão e saída estruturada."');

  await expectNoDocumentHorizontalOverflow(page);
  await expectTopbarControlsToFit(page);
  expect(pageErrors, "Unexpected browser errors while editing asset metadata").toEqual([]);
});

test("inspector panels render internal loading and error states", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);
  let releasePromptLoad;
  const promptLoadGate = new Promise((resolve) => {
    releasePromptLoad = resolve;
  });

  await page.route(`${apiUrl}/flows/reference-interview/prompts/system`, async (route) => {
    await promptLoadGate;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "system",
        path: "prompts/system.md",
        content: "# Prompt auditado\n\nCarregado depois do estado interno de loading.\n",
      }),
    });
  });
  await page.route(`${apiUrl}/flows/reference-interview/schemas/session_state`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "workspace_error", message: "Falha visual de schema." }),
    });
  });
  await page.route(`${apiUrl}/runtime-manifest`, async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "workspace_error", message: "Falha visual do manifesto." }),
    });
  });
  await page.route(
    (url) => url.href === `${apiUrl}/flows/reference-interview/studio-runs`,
    async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "workspace_error", message: "Falha visual de runs." }),
      });
    },
  );

  await openBuilder(page, "dark", viewports[0]);

  await openInspectorTab(page, "Arquivos");
  const filesPanel = page.locator(".assets-body");
  await expect(filesPanel.getByRole("status")).toContainText("Carregando prompt system.");
  releasePromptLoad();
  await expect(filesPanel.getByRole("alert")).toContainText("Erro ao carregar schema session_state: Falha visual de schema.");

  await openInspectorTab(page, "Runtime");
  await expect(page.locator(".runtime-manifest-body").getByRole("alert")).toContainText(
    "Erro ao carregar runtime.manifest.json: Falha visual do manifesto.",
  );

  await openInspectorTab(page, "Studio");
  const studioRunsSection = page.locator(".sandbox-section", { hasText: "Runs locais" });
  await expect(studioRunsSection.getByRole("alert")).toContainText("Erro ao carregar runs locais: Falha visual de runs.");
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");

  await expectNoDocumentHorizontalOverflow(page);
  await expectTopbarControlsToFit(page);
  const expectedErrors = [
    "500 (Internal Server Error)",
  ];
  const unexpectedErrors = pageErrors.filter((message) => !expectedErrors.some((expected) => message.includes(expected)));
  expect(unexpectedErrors, "Unexpected browser errors while rendering internal panel states").toEqual([]);
});

test("runtime manifest editor saves visual changes", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);
  await openBuilder(page, "light", viewports[0]);
  await openInspectorTab(page, "Runtime");

  const runtimePanel = page.locator(".runtime-manifest-body");
  await expect(runtimePanel.getByLabel("Nome")).toHaveValue("Reference Runtime");
  await runtimePanel.getByLabel("Nome").fill("Reference Runtime UI");
  await runtimePanel.getByLabel("Empacotamento").selectOption("multiagent");
  await runtimePanel.getByLabel("Prefixo da rota").fill("/reference-interview");
  await runtimePanel.getByLabel("Mock env").fill("MOCK_LLM");
  await expect(runtimePanel.getByText("editado")).toBeVisible();

  await runtimePanel.getByRole("button", { name: /Salvar/ }).click();
  await expect(runtimePanel.getByLabel("Nome")).toHaveValue("Reference Runtime UI");
  await expect(runtimePanel.locator(".runtime-pill", { hasText: "multiagent" })).toBeVisible();
  await runtimePanel.getByRole("button", { name: /Validar/ }).click();
  await expect(runtimePanel.getByText("Agentes válidos")).toBeVisible();
  await expect(runtimePanel.getByText("Mapa do bundle multiagente")).toBeVisible();
  await expect(runtimePanel.getByText("/reference-interview/sessions")).toBeVisible();
  await expect(runtimePanel.getByText("agents/reference-interview")).toBeVisible();
  await expect(runtimePanel.getByText("Validado contra o flow do workspace.")).toBeVisible();

  await expectNoDocumentHorizontalOverflow(page);
  await expectTopbarControlsToFit(page);
  expect(pageErrors, "Unexpected browser errors while saving runtime manifest visually").toEqual([]);
});

for (const theme of themes) {
  test(`studio runs with data render in ${theme} theme`, async ({ page, request }) => {
    const pageErrors = attachBrowserErrorCollector(page);
    await seedStudioRuns(request);

    await openBuilder(page, theme, viewports[0]);
    await openInspectorTab(page, "Studio");

    await expect(page.getByText("Runs locais")).toBeVisible();
    await expect(page.getByRole("button", { name: /ui-audit-error/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /ui-audit-ok/ })).toBeVisible();
    await expect(page.getByText("Agentes", { exact: true })).toBeVisible();
    await expect(page.locator(".studio-agent-list").getByRole("button", { name: /support-agent/ })).toBeVisible();

    await page.getByRole("button", { name: /ui-audit-error/ }).click();
    await expect(page.getByLabel("Filtrar timeline por agente")).toHaveValue("support-agent");
    await expect(page.getByRole("button", { name: /#3\s+node_failed/ })).toBeVisible();
    await page.getByRole("button", { name: /#3\s+node_failed/ }).click();
    await expect(page.getByText("input_safety_check").first()).toBeVisible();
    await expect(page.getByText("Cadeia causal")).toBeVisible();
    await expect(page.getByText("com falha")).toBeVisible();
    await expect(page.getByText("Impactados")).toBeVisible();
    await expect(page.getByText("llm_step").first()).toBeVisible();
    await expect(page.getByText("State inspector")).toBeVisible();
    await expect(page.getByText("Conteúdo inválido para este fluxo.", { exact: true })).toBeVisible();
    await expect(page.getByText("blocked by safety gate").first()).toBeVisible();
    const diagnosisSection = page.locator(".node-context-diagnosis", { hasText: "Diagnóstico" });
    await expect(diagnosisSection.getByText("Falha no nó")).toBeVisible();
    await expect(diagnosisSection.getByText(/O gate de safety bloqueou a execução: blocked by safety gate/)).toBeVisible();
    await expect(diagnosisSection.getByText(/Crie um fork do checkpoint para reexecutar a mesma entrada/)).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", theme);

    await page.getByRole("button", { name: /ui-audit-ok/ }).click();
    await expect(page.getByLabel("Filtrar timeline por agente")).toHaveValue("reference-interview");
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
    const structuredLogsSection = page.locator(".node-context-section", { hasText: "Logs estruturados" });
    await expect(structuredLogsSection).toBeVisible();
    const structuredLogCard = structuredLogsSection.locator(".node-context-span", { hasText: "target generate_questions" });
    await expect(structuredLogCard.getByText("mcp", { exact: true })).toBeVisible();
    await expect(structuredLogCard.getByText("custom_code_executed", { exact: true })).toBeVisible();
    await expect(structuredLogCard.getByText(/target generate_questions/)).toBeVisible();
    await structuredLogsSection.getByLabel("Buscar logs estruturados").fill("generate_questions");
    await structuredLogsSection.getByLabel("Filtrar logs estruturados por modo").selectOption("mcp");
    await structuredLogsSection.getByLabel("Filtrar logs estruturados por status").selectOption("custom_code_executed");
    await expect(structuredLogsSection.getByText("1/1", { exact: true })).toBeVisible();
    const [structuredLogsDownload] = await Promise.all([
      page.waitForEvent("download"),
      structuredLogsSection.getByRole("button", { name: /^Exportar$/ }).click(),
    ]);
    expect(structuredLogsDownload.suggestedFilename()).toBe("node-structured-logs-reference-interview-llm_step.json");
    const structuredLogsPath = await structuredLogsDownload.path();
    if (!structuredLogsPath) {
      throw new Error("Structured logs download path was not available.");
    }
    const structuredLogsExport = JSON.parse(await fs.readFile(structuredLogsPath, "utf8"));
    expect(structuredLogsExport.format).toBe("agent-flow-builder.node-structured-logs.v1");
    expect(structuredLogsExport.nodeId).toBe("llm_step");
    expect(structuredLogsExport.filters.query).toBe("generate_questions");
    expect(structuredLogsExport.logs[0].mode).toBe("mcp");
    expect(structuredLogsExport.logs[0].status).toBe("custom_code_executed");
    await expect(page.getByText("Restore de checkpoint", { exact: true })).toBeVisible();
    await expect(page.getByText(/Origem: snapshot.*sessão ui-audit-source.*turno 1/)).toBeVisible();
    await expect(page.getByText(/Estado: session, recent_messages, nodes/)).toBeVisible();
    await page.getByRole("button", { name: /ui-audit-error/ }).click();
    await page.getByRole("combobox", { name: /Comparar com/ }).selectOption("run-ui-audit-ok");
    await page.getByRole("button", { name: /^Comparar$/ }).click();
    const comparisonSection = page.locator(".studio-comparison-item", { hasText: "Comparação" });
    await expect(comparisonSection.getByText("Regressão funcional detectada.")).toBeVisible();
    await expect(comparisonSection.getByText("tokens", { exact: true })).toBeVisible();
    await expect(comparisonSection.getByText(/168 para -/)).toBeVisible();
    await page.getByRole("button", { name: /ui-audit-ok/ }).click();
    await page.getByRole("button", { name: /#4\s+llm_completed/ }).click();
    const llmDiagnosisSection = page.locator(".node-context-diagnosis", { hasText: "Diagnóstico" });
    await expect(llmDiagnosisSection.getByText("Sem falha associada")).toBeVisible();
    await expect(llmDiagnosisSection.getByText(/O nó LLM completou sem erro aparente/)).toBeVisible();
    await page.getByRole("button", { name: /^Fixar IO$/ }).click();
    await expect(page.getByText("Dados do nó llm_step fixados para replay local.")).toBeVisible();
    const nodePinsSection = page.locator(".sandbox-section", { hasText: "Pins de nó" });
    await expect(nodePinsSection.getByText("llm_step", { exact: true })).toBeVisible();
    await expect(nodePinsSection.getByText(/llm_prompt.*#4.*llm_completed/)).toBeVisible();
    await expect(nodePinsSection.getByText(/atual/).first()).toBeVisible();
    await page.getByLabel("Usar pins de nó como mock").check();
    await expect(page.getByLabel("Usar pins de nó como mock")).toBeChecked();
    await page.getByLabel("Tokens +%").fill("12");
    await page.getByRole("button", { name: /^Criar fork$/ }).click();
    await expect(page.getByText("Fork criado a partir do evento #4.")).toBeVisible();
    const scenarioSection = page.locator(".sandbox-section", { hasText: "Cenários de teste" });
    const selectedScenarioCard = scenarioSection.locator(".runtime-item", { hasText: "Fork llm_step #4" });
    await expect(selectedScenarioCard.getByText("Fork llm_step #4", { exact: true })).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Fork de checkpoint: .*#4.*llm_step/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Restore: checkpointer -> snapshot/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/compatibilidade: versão\/hash(\/projeto)? atuais/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Mock por pins de nó: 1 pin/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Thresholds: tokens \+12%.*custo \+20%.*duração \+30%/)).toBeVisible();
    const [fixtureDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^Exportar fixture$/ }).click(),
    ]);
    expect(fixtureDownload.suggestedFilename()).toBe("studio-fixture-fork-llm_step-4.json");
    const fixturePath = await fixtureDownload.path();
    if (!fixturePath) {
      throw new Error("Fixture download path was not available.");
    }
    const fixture = JSON.parse(await fs.readFile(fixturePath, "utf8"));
    expect(fixture.format).toBe("agent-flow-builder.replay-fixture.v1");
    expect(fixture.scenario.label).toBe("Fork llm_step #4");
    expect(fixture.scenario.regressionThresholds.tokenGrowthPct).toBe(12);
    expect(fixture.flow.flowHash).toMatch(/^[a-f0-9]{8}$/);
    expect(fixture.scenario.checkpoint.compatibility.flowId).toBe("reference-interview");
    expect(fixture.scenario.checkpoint.compatibility.flowVersion).toBe("0.1.0");
    expect(fixture.scenario.checkpoint.compatibility.flowHash).toMatch(/^[a-f0-9]{8}$/);
    expect(fixture.scenario.checkpoint.compatibility.nodeId).toBe("llm_step");
    expect(fixture.scenario.checkpoint.compatibility.nodeHash).toMatch(/^[a-f0-9]{8}$/);
    expect(fixture.metadata.checkpoint.compatibility.flowHash).toBe(fixture.scenario.checkpoint.compatibility.flowHash);
    expect(fixture.metadata.restore.compatibility.nodeHash).toBe(fixture.scenario.checkpoint.compatibility.nodeHash);
    expect(fixture.pins.enabled).toBe(true);
    expect(fixture.pins.activeCount).toBe(1);
    expect(fixture.metadata.nodePins.count).toBe(1);
    const [fixtureChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /^Importar fixture$/ }).click(),
    ]);
    await fixtureChooser.setFiles(fixturePath);
    await expect(page.getByText('Fixture "Fork llm_step #4" importada com 1 pin(s).')).toBeVisible();
    await expect(page.getByLabel("Usar pins de nó como mock")).toBeChecked();
    await expect(page.getByLabel("Tokens +%")).toHaveValue("12");
    await expect(nodePinsSection.getByText(/llm_prompt.*#4.*llm_completed/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Executar selecionado$/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Executar lote$/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Exportar relatório$/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Aprovar lote$/ })).toBeDisabled();
    await expect(page.locator(".turn-input")).toHaveValue("Aumentar conversões em onboarding.");

    const incompatibleFixture = JSON.parse(JSON.stringify(fixture));
    incompatibleFixture.scenario.id = `${fixture.scenario.id}-incompatible`;
    incompatibleFixture.scenario.label = "Fork incompatível";
    incompatibleFixture.scenario.checkpoint.compatibility.flowHash = "deadbeef";
    incompatibleFixture.metadata.checkpoint.compatibility.flowHash = "deadbeef";
    incompatibleFixture.metadata.restore.compatibility.flowHash = "deadbeef";
    const incompatibleFixturePath = fixturePath.replace(/\.json$/, "-incompatible.json");
    await fs.writeFile(incompatibleFixturePath, JSON.stringify(incompatibleFixture), "utf8");
    const [incompatibleFixtureChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /^Importar fixture$/ }).click(),
    ]);
    await incompatibleFixtureChooser.setFiles(incompatibleFixturePath);
    await expect(page.getByText('Fixture "Fork incompatível" importada com 1 pin(s).')).toBeVisible();
    await page.getByRole("button", { name: /^Executar selecionado$/ }).click();
    await expect(page.getByRole("alert")).toContainText(/não pode restaurar checkpoint: hash local do flow mudou/);

    await expectNoDocumentHorizontalOverflow(page);
    await expectTopbarControlsToFit(page);
    expect(pageErrors, `Unexpected browser errors in studio runs ${theme}`).toEqual([]);
  });
}

for (const theme of themes) {
  test(`general non-Docker status renders loading and error in ${theme} theme`, async ({ page }) => {
    const pageErrors = attachBrowserErrorCollector(page);
    await page.route(`${apiUrl}/flows/reference-interview/validate`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "workspace_error",
          message: "Falha controlada de validação visual.",
        }),
      });
    });

    await openBuilder(page, theme, viewports[0]);
    const validationRequest = page.waitForRequest(
      (request) => request.method() === "POST" && request.url() === `${apiUrl}/flows/reference-interview/validate`,
    );
    await page.getByRole("button", { name: /^Validar$/ }).click();
    await validationRequest;

    const busyStatus = page.getByRole("status");
    await expect(busyStatus).toHaveAttribute("data-state", "busy");
    await expect(busyStatus).toHaveAttribute("aria-busy", "true");
    await expect(busyStatus).toContainText("Validando reference-interview.");

    const errorStatus = page.getByRole("alert");
    await expect(errorStatus).toHaveAttribute("data-state", "error");
    await expect(errorStatus).toHaveAttribute("aria-live", "assertive");
    await expect(errorStatus).toContainText("Falha controlada de validação visual.");
    await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", theme);

    await expectNoDocumentHorizontalOverflow(page);
    await expectTopbarControlsToFit(page);
    const unexpectedErrors = pageErrors.filter((message) => !message.includes("422 (Unprocessable Entity)"));
    expect(unexpectedErrors, `Unexpected browser errors in non-Docker status ${theme}`).toEqual([]);
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
  const buildAlert = page.locator(".docker-alert-card").filter({ has: page.locator(".docker-alert-header strong", { hasText: /^Build$/ }) });
  const upAlert = page.locator(".docker-alert-card").filter({ has: page.locator(".docker-alert-header strong", { hasText: /^Up$/ }) });
  const smokeAlert = page.locator(".docker-alert-card").filter({ has: page.locator(".docker-alert-header strong", { hasText: /^Smoke$/ }) });
  await expect(page.getByText("Alertas operacionais")).toBeVisible();
  await expect(buildAlert.getByText("ok")).toBeVisible();

  await page.getByRole("button", { name: /^Up$/ }).click();
  await expect(page.getByText("Container Docker final iniciado.").first()).toBeVisible({ timeout: 10_000 });
  await expect(upAlert.getByText("ok")).toBeVisible();

  await page.getByRole("button", { name: /^Inspecionar$/ }).click();
  await expect(page.locator(".docker-service-row", { hasText: "api" }).getByText("running")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Application startup complete.")).toBeVisible();

  await page.getByRole("button", { name: /^Smoke$/ }).click();
  await expect(page.getByText(/Smoke test falhou/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("erro").first()).toBeVisible();
  await expect(smokeAlert.getByText("erro")).toBeVisible();
  await page.getByLabel("Nível").selectOption("error");
  await page.getByRole("button", { name: /^Aplicar$/ }).click();
  await expect(page.getByText(/Smoke test falhou/).first()).toBeVisible({ timeout: 10_000 });

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
        metadata: { source: "ui-theme-audit", agent_id: "reference-interview", scenario: "success" },
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
            custom: {
              answer: "Pergunta gerada",
              output: { assistant_message: "Pergunta gerada" },
              execution_log: {
                mode: "mcp",
                status: "custom_code_executed",
                duration_ms: 42,
                target: "generate_questions",
                input_path: "assistant_message.text",
              },
            },
            spans: [
              { name: "prompt_render", status: "ok", durationMs: 12 },
              { name: "llm_call", status: "ok", durationMs: 800, tokens: 168, costUsd: 0.0024 },
            ],
          },
        },
        { seq: 5, event_type: "node_completed", node: "output_safety_check", payload: { turn: 1, status: "ok", phase: "safety", safety: { blocked: false } } },
        { seq: 6, event_type: "node_completed", node: "deterministic_gate", payload: { turn: 2, status: "ok", phase: "completed", custom: { approved: true } } },
        {
          seq: 7,
          event_type: "checkpoint_restored",
          node: "start",
          payload: {
            source: "metadata",
            sourceSessionId: "ui-audit-source",
            status: "active",
            phase: "awaiting_turn",
            turn: 1,
            stateKeys: ["session", "recent_messages", "nodes"],
          },
        },
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
        metadata: { source: "ui-theme-audit", agent_id: "support-agent", scenario: "safety-error" },
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
