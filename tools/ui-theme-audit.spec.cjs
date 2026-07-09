const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");

const appUrl = process.env.BUILDER_UI_URL ?? "http://127.0.0.1:5273";
const apiUrl = process.env.BUILDER_API_URL ?? "http://127.0.0.1:3433";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "compact", width: 390, height: 844 },
];
const themes = ["light", "dark"];
const inspectorTabs = ["Editar", "Visão", "Arquivos", "Catálogo", "Governança", "Validação", "JSON", "Artefato", "Runtime", "Studio"];

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

test("command palette navigates and creates nodes", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await openBuilder(page, "light", viewports[0]);
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Paleta de comandos" });
  await expect(palette).toBeVisible();
  await expect(page.getByLabel("Buscar comando")).toBeFocused();
  await page.getByLabel("Buscar comando").fill("visao");
  await palette.getByRole("option", { name: /Abrir Visão/ }).click();
  await expect(page.locator(".tabs button", { hasText: "Visão" })).toHaveClass(/active/);

  await page.getByRole("button", { name: "Abrir paleta de comandos" }).click();
  await page.getByLabel("Buscar comando").fill("Adicionar HTTP");
  await palette.getByRole("option", { name: /Adicionar HTTP/ }).click();
  await expect(page.locator(".tabs button", { hasText: "Editar" })).toHaveClass(/active/);
  await expect(page.locator(".react-flow__node.selected")).toContainText("http_request");
  await expect(page.locator("footer[role='status']")).toContainText("criado");

  await page.getByRole("button", { name: "Abrir paleta de comandos" }).click();
  await page.getByLabel("Buscar comando").fill("Duplicar nó selecionado");
  await palette.getByRole("option", { name: /Duplicar nó selecionado/ }).click();
  await expect(page.locator(".react-flow__node.selected")).toContainText(/http_request.*copy/);
  await expect(page.locator("footer[role='status']")).toContainText("duplicado como");

  await page.getByRole("button", { name: "Abrir paleta de comandos" }).click();
  await page.getByLabel("Buscar comando").fill("Remover seleção");
  await palette.getByRole("option", { name: /Remover seleção do canvas/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("removido");

  await page.locator(".canvas-node-chip", { hasText: "llm_step" }).click();
  await page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Inserir etapa" }).click();
  await expect(page.getByLabel("Buscar comando")).toHaveValue("Inserir ");
  await page.getByLabel("Buscar comando").fill("Inserir HTTP no fluxo");
  await palette.getByRole("option", { name: /Inserir HTTP no fluxo/ }).click();
  await expect(page.locator(".tabs button", { hasText: "Editar" })).toHaveClass(/active/);
  await expect(page.locator(".react-flow__node.selected")).toContainText("http_request");
  await expect(page.locator("footer[role='status']")).toContainText("inserido após llm_step");

  await page.locator(".canvas-node-chip", { hasText: "input_safety_check" }).click();
  await page.getByRole("button", { name: "Abrir paleta de comandos" }).click();
  await page.getByLabel("Buscar comando").fill("Selecionar downstream");
  await palette.getByRole("option", { name: /Selecionar downstream do nó/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("downstream de input_safety_check");
  await expect(page.getByLabel("Ações da seleção do canvas")).toContainText("5 nós selecionados");

  await page.locator(".canvas-node-chip", { hasText: "llm_step" }).click();
  await page.getByRole("button", { name: "Abrir paleta de comandos" }).click();
  await page.getByLabel("Buscar comando").fill("Abrir prompt do nó");
  await palette.getByRole("option", { name: /Abrir prompt do nó/ }).click();
  await expect(page.locator(".tabs button", { hasText: "Arquivos" })).toHaveClass(/active/);
  await expect(page.locator("footer[role='status']")).toContainText("Prompt");

  expect(pageErrors, "Unexpected browser errors while using command palette").toEqual([]);
});

test("builder governance auth policy controls render", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await openBuilder(page, "light", viewports[0]);
  await page.locator(".tabs button", { hasText: "Governança" }).click();
  const builderAuth = page.locator(".section-card", { hasText: "Auth local do Builder" });
  await expect(builderAuth).toBeVisible();
  await expect(builderAuth.getByLabel("Sessão local do Builder")).toContainText("Nenhuma sessão local ativa");
  await expect(builderAuth.getByLabel("Sessão local do Builder")).toContainText("Persistência central local");
  await expect(builderAuth.getByLabel("Sessão local do Builder")).toContainText("Serviço corporativo de sessão");
  await expect(builderAuth.getByLabel("Sessão local do Builder")).toContainText("Decisão central de sessão");
  await expect(builderAuth.getByLabel("Auditoria central do Builder")).toContainText("sink central HTTP");
  await expect(builderAuth.getByLabel("Auditoria central do Builder")).toContainText("Eventos sem chave bruta");
  await expect(builderAuth.getByLabel("Probe corporativo do Builder")).toContainText("Ainda não testado");
  await expect(builderAuth.getByRole("button", { name: "Criar sessão" })).toBeDisabled();
  await expect(builderAuth.getByRole("button", { name: "Renovar" })).toBeDisabled();
  await expect(builderAuth.getByRole("button", { name: "Encerrar sessão" })).toBeDisabled();
  await expect(builderAuth.getByLabel("JWT corporativo do Builder")).toContainText("Desligado");
  await expect(builderAuth.getByLabel("JWT corporativo do Builder")).toContainText("grupos");
  await expect(builderAuth.getByLabel("JWT corporativo do Builder")).toContainText("Políticas de grupos");
  await expect(builderAuth.getByLabel("JWT corporativo do Builder")).toContainText("Diretório de grupos");
  await expect(builderAuth.getByLabel("JWT corporativo do Builder")).toContainText("Fonte externa");
  await expect(builderAuth.getByRole("button", { name: "Entrar OIDC" })).toBeDisabled();
  await expect(builderAuth.getByRole("button", { name: "Sair OIDC" })).toBeDisabled();
  await expect(builderAuth).toContainText("Rotação local");
  await expect(builderAuth.getByLabel("Expiração da chave do Builder")).toBeVisible();
  await expect(builderAuth.getByLabel("Scopes")).toHaveValue("*");
  await expect(builderAuth.getByLabel("Áreas")).toHaveValue("*");
  await expect(builderAuth.getByLabel("Política visual da chave do Builder")).toContainText("Política ampla");

  await builderAuth.getByLabel("Áreas").fill("governance,schemas");
  await builderAuth.getByRole("button", { name: "Workspace" }).click();
  await builderAuth.getByRole("button", { name: "7 dias" }).click();
  await expect(builderAuth.getByLabel("Scopes")).toHaveValue("workspace:read,workspace:write");
  await expect(builderAuth.getByLabel("Expiração da chave do Builder")).not.toHaveValue("");
  await expect(builderAuth.getByLabel("Política visual da chave do Builder")).toContainText("Política limitada");

  await builderAuth.getByRole("button", { name: "Sem expiração" }).click();
  await expect(builderAuth.getByLabel("Expiração da chave do Builder")).toHaveValue("");
  await expect(builderAuth.getByLabel("Política visual da chave do Builder")).toContainText("Sem expiração configurada");

  await builderAuth.getByLabel("Limite da auditoria do Builder").fill("10");
  await builderAuth.getByLabel("Status da auditoria do Builder").selectOption("allowed");
  await builderAuth.getByLabel("Rota da auditoria do Builder").fill("flows");
  await builderAuth.getByLabel("Busca da auditoria do Builder").fill("builder");
  await builderAuth.getByRole("button", { name: "Atualizar auth" }).click();
  await expect(builderAuth.getByLabel("Filtro aplicado da auditoria do Builder")).toContainText("status allowed");
  await expect(builderAuth.getByLabel("Resumo agregado da auditoria do Builder")).toContainText("Rotas");

  await builderAuth.getByRole("button", { name: "Testar integrações" }).click();
  await expect(builderAuth.getByLabel("Probe corporativo do Builder")).toContainText("0/0 integração");
  await expect(builderAuth.getByLabel("Probe corporativo do Builder")).toContainText("não configurado");
  await expect(builderAuth.getByLabel("Probe corporativo do Builder")).toContainText("não inclui URLs");

  const exportAuditButton = builderAuth.getByRole("button", { name: "Exportar auditoria" });
  await expect(exportAuditButton).toBeEnabled();
  const [builderAuthAuditDownload] = await Promise.all([
    page.waitForEvent("download"),
    exportAuditButton.click(),
  ]);
  expect(builderAuthAuditDownload.suggestedFilename()).toBe("builder-auth-audit.afbuilderauthaudit.json");
  const builderAuthAuditPath = await builderAuthAuditDownload.path();
  expect(builderAuthAuditPath).toBeTruthy();
  const builderAuthAudit = JSON.parse(await fs.readFile(builderAuthAuditPath, "utf-8"));
  expect(builderAuthAudit.format).toBe("agent-flow-builder.builder-auth-audit.v1");
  expect(builderAuthAudit.query.limit).toBe(10);
  expect(builderAuthAudit.query.status).toBe("allowed");
  expect(builderAuthAudit.query.route).toBe("flows");
  expect(builderAuthAudit.query.q).toBe("builder");
  expect(builderAuthAudit.summary.returnedCount).toBe(builderAuthAudit.entries.length);
  expect(builderAuthAudit.governance.excludesRawKeyValues).toBe(true);
  expect(builderAuthAudit.governance.excludesHeaders).toBe(true);
  expect(JSON.stringify(builderAuthAudit)).not.toContain("X-Agent-Flow-Builder-Key");
  expect(JSON.stringify(builderAuthAudit)).not.toContain("Authorization");

  expect(pageErrors, "Unexpected browser errors while using builder auth policy controls").toEqual([]);
});

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
  await page.locator(".right-panel").getByLabel("Descrição").fill("Checagem visual de entrada.");
  await expect(page.locator(".react-flow__node.dirty-node.selected")).toContainText("input_safety_check");
  const canvasActions = page.getByLabel("Ações da seleção do canvas");
  await expect(canvasActions).toContainText("input_safety_check");
  await canvasActions.getByRole("button", { name: "Focar seleção" }).click();
  await expect(canvasActions.getByRole("button", { name: "Duplicar nó" })).toBeEnabled();
  await canvasActions.getByRole("button", { name: "Duplicar nó" }).click();
  await expect(page.locator(".react-flow__node.selected")).toContainText(/input_safety_check_copy/);
  await expect(page.locator("footer[role='status']")).toContainText("duplicado como");
  await page.keyboard.press("Delete");
  await expect(page.locator("footer[role='status']")).toContainText("removido");
  await page.getByRole("button", { name: "Organizar grafo" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Grafo organizado automaticamente");
  await expect(page.getByRole("button", { name: /^Salvar$/ })).toBeEnabled();
  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await page.locator(".canvas-node-chip", { hasText: "input_safety_check" }).click();
  await page.keyboard.down("Shift");
  await page.locator(".canvas-node-chip", { hasText: "llm_step" }).click();
  await page.keyboard.up("Shift");
  await expect(page.getByLabel("Ações da seleção do canvas")).toContainText("2 nós selecionados");
  await expect(page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Alinhar linha" })).toBeEnabled();
  await page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Alinhar linha" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("2 nós alinhados pela linha média");
  await page.keyboard.down("Shift");
  await page.locator(".canvas-node-chip", { hasText: "output_safety_check" }).click();
  await page.keyboard.up("Shift");
  await expect(page.getByLabel("Ações da seleção do canvas")).toContainText("3 nós selecionados");
  await expect(page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Distribuir" })).toBeEnabled();
  await page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Distribuir" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("3 nós distribuídos horizontalmente");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Tags para aplicar");
    await dialog.accept("audit, review");
  });
  await page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Aplicar tags" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Tags audit, review aplicadas em 3 nós");
  await expect(page.locator(".right-panel").getByLabel("Tags do nó")).toHaveValue("audit, review");
  const batchEditor = page.getByLabel("Edição em lote da seleção");
  await expect(batchEditor).toContainText("3 nós selecionados");
  await expect(batchEditor).toContainText("1 compatível");
  await expect(batchEditor).toContainText("2 safety gates");
  await batchEditor.getByLabel("Schema em lote").selectOption("turn_output");
  await batchEditor.getByRole("button", { name: "Aplicar schema" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Schema turn_output aplicado em 1 nó compatível");
  await batchEditor.getByLabel("Stage em lote").selectOption("context");
  await batchEditor.getByRole("button", { name: "Aplicar stage" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Stage context aplicado em 2 nós compatíveis");
  await expect(page.locator(".right-panel .edit-group label", { hasText: "Stage" }).locator("select")).toHaveValue("context");

  await page.locator(".palette-item", { hasText: "HTTP" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("criado");
  const createdHttpNodeId = await page.locator(".react-flow__node.selected").getAttribute("data-id");
  expect(createdHttpNodeId).toMatch(/^http_request_/);
  await searchInput.fill("");
  await typeFilter.selectOption("");
  await page.locator(".canvas-node-chip", { hasText: "deterministic_gate" }).click();
  await page.keyboard.down("Shift");
  await page.locator(".canvas-node-chip", { hasText: createdHttpNodeId }).click();
  await page.keyboard.up("Shift");
  await expect(page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Conectar sequência" })).toBeEnabled();
  await page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Conectar sequência" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("1 conexão criada entre nós selecionados");
  const executionBatchEditor = page.getByLabel("Edição em lote da seleção");
  await expect(executionBatchEditor).toContainText("1 nó code");
  await expect(executionBatchEditor).toContainText("1 nó HTTP");
  await executionBatchEditor.getByLabel("Linguagem code em lote").selectOption("typescript");
  await executionBatchEditor.getByRole("button", { name: "Aplicar linguagem" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Linguagem typescript aplicada em 1 nó compatível");
  await executionBatchEditor.getByLabel("Execução code em lote").selectOption("file");
  await executionBatchEditor.getByRole("button", { name: "Aplicar execução" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Execução file aplicada em 1 nó compatível");
  await executionBatchEditor.getByLabel("Input path code em lote").fill("state.payload");
  await executionBatchEditor.getByRole("button", { name: "Aplicar input" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Input path state.payload aplicado em 1 nó compatível");
  await executionBatchEditor.getByLabel("Result path code em lote").fill("custom.batch");
  await executionBatchEditor.getByRole("button", { name: "Aplicar result" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Result path custom.batch aplicado em 1 nó compatível");
  await executionBatchEditor.getByLabel("Método HTTP em lote").selectOption("PATCH");
  await executionBatchEditor.getByRole("button", { name: "Aplicar método" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Método PATCH aplicado em 1 nó compatível");
  await executionBatchEditor.getByLabel("URL HTTP em lote").fill("mock://echo");
  await executionBatchEditor.getByRole("button", { name: "Aplicar URL" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("URL mock://echo aplicada em 1 nó compatível");
  await executionBatchEditor.getByLabel("Body path HTTP em lote").fill("payload.request");
  await executionBatchEditor.getByRole("button", { name: "Aplicar body" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Body path payload.request aplicado em 1 nó compatível");
  await executionBatchEditor.getByLabel("Response path HTTP em lote").fill("http.batch");
  await executionBatchEditor.getByRole("button", { name: "Aplicar response" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Response path http.batch aplicado em 1 nó compatível");
  await page.locator(".canvas-node-chip", { hasText: "deterministic_gate" }).click();
  await expect(page.locator(".right-panel .edit-group label", { hasText: "Linguagem" }).locator("select")).toHaveValue("typescript");
  await expect(page.locator(".right-panel .edit-group label", { hasText: "Modo de execução" }).locator("select")).toHaveValue("file");
  await expect(page.locator(".right-panel .edit-group label", { hasText: "Input path" }).locator("input")).toHaveValue("state.payload");
  await expect(page.locator(".right-panel .edit-group label", { hasText: "Result path" }).locator("input")).toHaveValue("custom.batch");
  await page.locator(".canvas-node-chip", { hasText: createdHttpNodeId }).click();
  const rightPanel = page.locator(".right-panel");
  await expect(rightPanel.getByLabel("URL", { exact: true })).toHaveValue("mock://echo");
  await expect(rightPanel.getByLabel("Body path", { exact: true })).toHaveValue("payload.request");
  await expect(rightPanel.getByLabel("Response path", { exact: true })).toHaveValue("http.batch");
  await expect(page.locator(".right-panel .edit-group label", { hasText: "Método" }).locator("select")).toHaveValue("PATCH");
  await page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Remover seleção" }).click();
  await expect(page.locator("footer[role='status']")).toContainText(`Nó ${createdHttpNodeId} removido`);

  await searchInput.fill("audit");
  await expect(page.locator(".canvas-search-summary")).toHaveText("3/8");
  await searchInput.fill("");
  await page.locator(".canvas-node-chip", { hasText: "input_safety_check" }).click();
  await page.keyboard.down("Shift");
  await page.locator(".canvas-node-chip", { hasText: "llm_step" }).click();
  await page.locator(".canvas-node-chip", { hasText: "output_safety_check" }).click();
  await page.keyboard.up("Shift");
  await expect(page.getByLabel("Ações da seleção do canvas")).toContainText("3 nós selecionados");
  await page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Limpar tags" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Tags removidas de 3 nós");
  await expect(page.locator(".right-panel").getByLabel("Tags do nó")).toHaveValue("");

  await searchInput.fill("");
  await typeFilter.selectOption("llm_prompt");
  await expect(page.locator(".canvas-search-summary")).toHaveText("1/8");
  const llmStepChip = page.locator(".canvas-node-chip", { hasText: "llm_step" });
  await expect(llmStepChip).toContainText("llm_step");
  await llmStepChip.click();
  await expect(page.getByLabel("Ações da seleção do canvas")).toContainText("llm_step");
  await expect(page.locator(".right-panel .edit-group label", { hasText: "Schema" }).locator("select")).toHaveValue("turn_output");
  await page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Abrir prompt" }).click();
  await expect(page.locator(".tabs button", { hasText: "Arquivos" })).toHaveClass(/active/);
  await expect(page.getByLabel("Selecionar prompt")).toHaveValue("system");

  await page.getByRole("button", { name: "Limpar", exact: true }).click();
  await expect(searchInput).toHaveValue("");
  await expect(typeFilter).toHaveValue("");
  await expectNoDocumentHorizontalOverflow(page);
  expect(pageErrors, "Unexpected browser errors while using canvas finder").toEqual([]);
});

test("safety policy library saves exports imports and applies policies", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await page.addInitScript(() => {
    window.localStorage.setItem("agent-flow-builder.studio-annotation-reviewer.v1", "qa-safety");
  });
  await openBuilder(page, "light", viewports[0]);

  await page.locator(".canvas-node-chip", { hasText: "input_safety_check" }).click();
  const rightPanel = page.locator(".right-panel");
  const field = (labelText) => rightPanel.locator(".edit-group label", { hasText: labelText });
  const safetyLibrary = rightPanel.getByLabel("Biblioteca de políticas de Safety");

  await expect(safetyLibrary).toContainText("0 políticas locais");
  await field("Modo safety").locator("select").selectOption("default_and_custom");
  await field("Severidade mínima").locator("select").selectOption("medium");
  await field("Resposta segura padrão").locator("textarea").fill("Posso ajudar sem processar dados pessoais.");
  const rules = [
    {
      id: "privacy_document",
      label: "Documento pessoal",
      match: "cpf",
      matchType: "contains",
      category: "privacy",
      severity: "high",
      action: "safe_redirect",
      safeResponse: "Posso ajudar sem expor dados pessoais.",
    },
  ];
  await field("Regras JSON").locator("textarea").fill(JSON.stringify(rules, null, 2));
  await field("Regras JSON").locator("textarea").blur();
  await expect(page.locator("footer[role='status']")).toContainText("Regras de safety atualizadas");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Nome da política de Safety reutilizável");
    await dialog.accept("LGPD local");
  });
  await safetyLibrary.getByRole("button", { name: "Salvar política" }).click();
  await expect(page.locator("footer[role='status']")).toContainText('Política de Safety "LGPD local" salva');
  await expect(safetyLibrary).toContainText("LGPD local");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    safetyLibrary.getByRole("button", { name: "Exportar" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("safety-policy-profiles.afsafety.json");
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const safetyFile = JSON.parse(await fs.readFile(downloadPath, "utf-8"));
  expect(safetyFile.format).toBe("agent-flow-builder.safety-policy-profiles.v1");
  expect(safetyFile.profiles[0].rules[0].id).toBe("privacy_document");

  await safetyLibrary.locator(".runtime-item", { hasText: "LGPD local" }).getByRole("button", { name: "Remover" }).click();
  await expect(page.locator("footer[role='status']")).toContainText('Política de Safety "LGPD local" removida');

  safetyFile.profiles[0].id = "safety-policy-imported";
  safetyFile.profiles[0].name = "LGPD importada";
  safetyFile.profiles[0].severityThreshold = "high";
  safetyFile.profiles[0].fallbackResponse = "Resposta segura importada.";
  safetyFile.profiles[0].rules[0].match = "rg";
  await rightPanel.getByLabel("Importar biblioteca de Safety").setInputFiles({
    name: "safety-policy-profiles.afsafety.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(safetyFile), "utf-8"),
  });
  await expect(page.locator("footer[role='status']")).toContainText("Biblioteca de Safety importada");
  await expect(safetyLibrary).toContainText("LGPD importada");

  await safetyLibrary.locator(".runtime-item", { hasText: "LGPD importada" }).getByRole("button", { name: "Aplicar" }).click();
  await expect(page.locator("footer[role='status']")).toContainText('Política de Safety "LGPD importada" aplicada');
  await expect(field("Severidade mínima").locator("select")).toHaveValue("high");
  await expect(field("Resposta segura padrão").locator("textarea")).toHaveValue("Resposta segura importada.");
  await expect(field("Regras JSON").locator("textarea")).toHaveValue(/"match": "rg"/);

  const safetyHarness = rightPanel.locator('section[aria-label="Safety Harness"]');
  await expect(safetyHarness).toContainText("Safety Harness");
  await expect(safetyHarness).toContainText("revisor qa-safety");
  const safetyDashboard = safetyHarness.locator('[aria-label="Dashboard do Safety Harness"]');
  await expect(safetyDashboard).toContainText("Dashboard local");
  await expect(safetyDashboard).toContainText("0 run(s) neste nó");
  await expect(safetyDashboard).toContainText("Bloqueio do nó");
  await expect(safetyDashboard.getByRole("button", { name: /^Aceitar próximo$/ })).toBeDisabled();
  await safetyHarness.getByLabel("Texto de teste").fill("rg");
  await safetyHarness.getByRole("button", { name: /^Avaliar safety$/ }).click();
  await expect(page.locator("footer[role='alert']")).toContainText("Safety Harness: bloqueado", { timeout: 10_000 });
  await expect(safetyDashboard).toContainText("1 run(s) neste nó");
  await expect(safetyDashboard).toContainText("100%");
  await expect(safetyDashboard).toContainText("privacy (1)");
  await expect(safetyDashboard.getByRole("button", { name: /^Aceitar próximo$/ })).toBeEnabled();
  await expect(safetyHarness).toContainText("Bloqueado");
  await expect(safetyHarness).toContainText("privacy");
  await safetyDashboard.getByRole("button", { name: /^Aceitar próximo$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Run de Safety Harness marcado como aceito");
  await expect(safetyHarness).toContainText("revisão aceito");
  await expect(safetyHarness).toContainText("Revisor: qa-safety");
  await expect(safetyDashboard.getByRole("button", { name: /^Aceitar próximo$/ })).toBeDisabled();
  const [safetyHarnessHistoryDownload] = await Promise.all([
    page.waitForEvent("download"),
    safetyDashboard.getByRole("button", { name: /^Exportar histórico$/ }).click(),
  ]);
  expect(safetyHarnessHistoryDownload.suggestedFilename()).toBe("safety-harness-history-reference-interview.afsafetyhistory.json");
  const safetyHarnessHistoryPath = await safetyHarnessHistoryDownload.path();
  expect(safetyHarnessHistoryPath).toBeTruthy();
  const safetyHarnessHistoryFile = JSON.parse(await fs.readFile(safetyHarnessHistoryPath, "utf-8"));
  expect(safetyHarnessHistoryFile.format).toBe("agent-flow-builder.safety-harness-history.v1");
  expect(safetyHarnessHistoryFile.runCount).toBeGreaterThanOrEqual(1);
  expect(safetyHarnessHistoryFile.acceptedCount).toBeGreaterThanOrEqual(1);
  expect(safetyHarnessHistoryFile.runs[0].review.reviewer).toBe("qa-safety");
  expect(safetyHarnessHistoryFile.governance.includesRawInput).toBe(false);
  expect(safetyHarnessHistoryFile.governance.includesSecrets).toBe(false);
  expect(safetyHarnessHistoryFile.runs[0].inputPreview).toBeTruthy();
  const [safetyHarnessHistoryDiffDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByLabel("Comparar histórico governado de Safety Harness").setInputFiles({
      name: "safety-harness-history-reference-interview.afsafetyhistory.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(safetyHarnessHistoryFile), "utf-8"),
    }),
  ]);
  expect(safetyHarnessHistoryDiffDownload.suggestedFilename()).toMatch(
    /^safety-harness-history-diff-reference-interview-[a-f0-9]+\.afsafetyhistory-diff\.json$/,
  );
  const safetyHarnessHistoryDiffPath = await safetyHarnessHistoryDiffDownload.path();
  expect(safetyHarnessHistoryDiffPath).toBeTruthy();
  const safetyHarnessHistoryDiffFile = JSON.parse(await fs.readFile(safetyHarnessHistoryDiffPath, "utf-8"));
  const safetyHarnessHistoryDiffText = JSON.stringify(safetyHarnessHistoryDiffFile);
  expect(safetyHarnessHistoryDiffFile.format).toBe("agent-flow-builder.safety-harness-history-diff.v1");
  expect(safetyHarnessHistoryDiffFile.summary.unchangedCount).toBeGreaterThanOrEqual(1);
  expect(safetyHarnessHistoryDiffFile.governance.excludesRawInput).toBe(true);
  expect(safetyHarnessHistoryDiffFile.governance.excludesInputPreview).toBe(true);
  expect(safetyHarnessHistoryDiffFile.governance.excludesMatchedText).toBe(true);
  expect(safetyHarnessHistoryDiffFile.governance.excludesExternalHeaders).toBe(true);
  expect(safetyHarnessHistoryDiffFile.governance.excludesSecretValues).toBe(true);
  expect(safetyHarnessHistoryDiffText).not.toContain("inputPreview");
  expect(safetyHarnessHistoryDiffText).not.toContain("matchedText");
  expect(safetyHarnessHistoryDiffText).not.toContain("rg");

  await expectNoDocumentHorizontalOverflow(page);
  expect(pageErrors, "Unexpected browser errors while using safety policy library").toEqual([]);
});

test("code sandbox policy library saves exports imports and applies profiles", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await openBuilder(page, "light", viewports[0]);
  await page.locator(".canvas-node-chip", { hasText: "deterministic_gate" }).click();
  const rightPanel = page.locator(".right-panel");
  const field = (labelText) => rightPanel.locator(".edit-group label", { hasText: labelText });
  const sandboxLibrary = rightPanel.getByLabel("Biblioteca de perfis de sandbox de código");

  await expect(sandboxLibrary).toContainText("Nenhum perfil salvo");
  await field("Modo de execução").locator("select").selectOption("native");
  await field("Isolamento").locator("select").selectOption("container");
  await field("Imagem gerenciada").locator("select").selectOption("python-3-12-slim");
  await expect(rightPanel.getByLabel("Detalhes da imagem gerenciada")).toContainText("Python 3.12 slim");
  await expect(rightPanel.getByLabel("Detalhes da imagem gerenciada")).toContainText("python:3.12-slim");
  await expect(field("Imagem do container").locator("input")).toHaveValue("python:3.12-slim");
  await expect(field("Engine").locator("input")).toHaveValue("docker");
  await field("Orquestração").locator("select").selectOption("hardened");
  await expect(rightPanel.getByLabel("Detalhes da orquestração de container")).toContainText("Hardened");
  await expect(field("Memória").locator("input")).toHaveValue("512m");
  await expect(field("CPUs").locator("input")).toHaveValue("1");
  await expect(field("PIDs limit").locator("input")).toHaveValue("128");
  await expect(field("Rootfs read-only").locator("input")).toBeChecked();
  await expect(field("Remover capabilities").locator("input")).toBeChecked();
  await expect(field("No new privileges").locator("input")).toBeChecked();
  await field("Modo de execução").locator("select").selectOption("sidecar");
  await expect(field("Isolamento").locator("select")).toContainText("Container dedicado");
  await field("Comando sidecar").locator("input").fill("python");
  await field("Timeout (s)").locator("input").fill("45");
  await field("Tentativas extras").locator("input").fill("2");
  await field("Allowlist de payload").locator("textarea").fill("user_message\nsession_metadata.customer_id");
  await field("Redaction por caminho").locator("textarea").fill("session_metadata.api_key");
  await field("Payload máximo (bytes)").locator("input").fill("2048");
  await field("Isolamento").locator("select").selectOption("ephemeral_workspace");
  await field("Env allowlist").locator("textarea").fill("PATH\nCUSTOM_TOOL_TOKEN");

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Nome do perfil de sandbox reutilizável");
    await dialog.accept("Sidecar restrito");
  });
  await sandboxLibrary.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.locator("footer[role='status']")).toContainText('Perfil de sandbox "Sidecar restrito" salvo');
  await expect(sandboxLibrary).toContainText("Sidecar restrito");
  await expect(sandboxLibrary).toContainText("ephemeral_workspace");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    sandboxLibrary.getByRole("button", { name: "Exportar" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("code-sandbox-policy-profiles.afcodesandbox.json");
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const sandboxFile = JSON.parse(await fs.readFile(downloadPath, "utf-8"));
  expect(sandboxFile.format).toBe("agent-flow-builder.code-sandbox-policy-profiles.v1");
  expect(sandboxFile.profiles[0].payloadAllowPaths).toContain("user_message");
  expect(sandboxFile.profiles[0].sandboxEnvAllowlist).toContain("CUSTOM_TOOL_TOKEN");

  await sandboxLibrary.locator(".batch-preset-card", { hasText: "Sidecar restrito" }).getByRole("button", { name: "Remover" }).click();
  await expect(page.locator("footer[role='status']")).toContainText('Perfil de sandbox "Sidecar restrito" removido');

  sandboxFile.profiles[0].id = "code-sandbox-imported";
  sandboxFile.profiles[0].name = "Sandbox importado";
  sandboxFile.profiles[0].sandboxIsolation = "container";
  sandboxFile.profiles[0].sandboxContainerImageId = "python-3-12-slim";
  sandboxFile.profiles[0].sandboxContainerImage = "python:3.12-slim";
  sandboxFile.profiles[0].sandboxContainerEngine = "docker";
  sandboxFile.profiles[0].sandboxContainerProfile = "hardened";
  sandboxFile.profiles[0].sandboxContainerMemory = "768m";
  sandboxFile.profiles[0].sandboxContainerCpus = "0.5";
  sandboxFile.profiles[0].sandboxContainerPidsLimit = 64;
  sandboxFile.profiles[0].sandboxContainerReadOnlyRootfs = true;
  sandboxFile.profiles[0].sandboxContainerDropCapabilities = true;
  sandboxFile.profiles[0].sandboxContainerNoNewPrivileges = true;
  sandboxFile.profiles[0].retryAttempts = 3;
  sandboxFile.profiles[0].payloadAllowPaths = ["assistant_message.text"];
  sandboxFile.profiles[0].redactPaths = ["session_metadata.secret_value"];
  sandboxFile.profiles[0].maxPayloadBytes = 4096;
  sandboxFile.profiles[0].timeoutSeconds = 60;
  await sandboxLibrary.getByLabel("Importar biblioteca de sandbox de código").setInputFiles({
    name: "code-sandbox-policy-profiles.afcodesandbox.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(sandboxFile), "utf-8"),
  });
  await expect(page.locator("footer[role='status']")).toContainText("Biblioteca de sandbox importada");
  await expect(sandboxLibrary).toContainText("Sandbox importado");

  await sandboxLibrary.locator(".batch-preset-card", { hasText: "Sandbox importado" }).getByRole("button", { name: "Aplicar" }).click();
  await expect(page.locator("footer[role='status']")).toContainText('Perfil de sandbox "Sandbox importado" aplicado');
  await expect(field("Isolamento").locator("select")).toHaveValue("container");
  await expect(field("Imagem gerenciada").locator("select")).toHaveValue("python-3-12-slim");
  await expect(field("Imagem do container").locator("input")).toHaveValue("python:3.12-slim");
  await expect(field("Engine").locator("input")).toHaveValue("docker");
  await expect(field("Orquestração").locator("select")).toHaveValue("hardened");
  await expect(field("Memória").locator("input")).toHaveValue("768m");
  await expect(field("CPUs").locator("input")).toHaveValue("0.5");
  await expect(field("PIDs limit").locator("input")).toHaveValue("64");
  await expect(field("Rootfs read-only").locator("input")).toBeChecked();
  await expect(field("Remover capabilities").locator("input")).toBeChecked();
  await expect(field("No new privileges").locator("input")).toBeChecked();
  await expect(field("Tentativas extras").locator("input")).toHaveValue("3");
  await expect(field("Allowlist de payload").locator("textarea")).toHaveValue("assistant_message.text");
  await expect(field("Redaction por caminho").locator("textarea")).toHaveValue("session_metadata.secret_value");
  await expect(field("Payload máximo (bytes)").locator("input")).toHaveValue("4096");
  await expect(field("Timeout (s)").locator("input")).toHaveValue("60");
  await field("Isolamento").locator("select").selectOption("vm");
  await field("Imagem VM gerenciada").locator("select").selectOption("python-qemu-microvm");
  await expect(rightPanel.getByLabel("Detalhes da imagem VM gerenciada")).toContainText("Python QEMU microVM");
  await expect(rightPanel.getByLabel("Detalhes da imagem VM gerenciada")).toContainText("images/agent-flow-python.qcow2");
  await expect(field("Runner VM").locator("input")).toHaveValue("agent-flow-vm-runner");
  await expect(field("Args do runner").locator("textarea")).toHaveValue("--engine\nqemu");
  await expect(field("Imagem VM").locator("input")).toHaveValue("images/agent-flow-python.qcow2");
  await expect(field("Perfil VM").locator("select")).toHaveValue("hardened");
  await expect(rightPanel.getByLabel("Detalhes do perfil de VM")).toContainText("VM hardened");
  await expect(field("Memória VM").locator("input")).toHaveValue("1024m");
  await expect(field("vCPUs").locator("input")).toHaveValue("1");
  await page.route(`${apiUrl}/flows/reference-interview/code-vm-runner/check`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        format: "agent-flow-builder.vm-runner-check.v1",
        checkedAt: "2026-07-02T00:00:00.000Z",
        flowId: "reference-interview",
        nodeId: "deterministic_gate",
        status: "ready",
        protocol: "agent-flow-vm-runner.v1",
        executesUserCode: false,
        runner: {
          value: "agent-flow-vm-runner",
          source: "node",
          resolved: true,
          path: "C:\\tools\\agent-flow-vm-runner.cmd",
          args: ["--engine", "qemu"],
        },
        image: {
          value: "images/agent-flow-python.qcow2",
          source: "node",
          resolved: true,
          path: "C:\\workspace\\flows\\reference-interview\\images\\agent-flow-python.qcow2",
        },
        policy: {
          imageId: "python-qemu-microvm",
          profile: "hardened",
          memory: "1024m",
          cpus: "1",
        },
        checks: [
          {
            id: "protocol",
            label: "Contrato",
            level: "ok",
            message: "O checker usa o contrato agent-flow-vm-runner.v1 e não executa código do usuário.",
          },
          {
            id: "runner",
            label: "Runner VM",
            level: "ok",
            message: "Runner VM resolvido por configuração do nó.",
            path: "C:\\tools\\agent-flow-vm-runner.cmd",
          },
          {
            id: "image",
            label: "Imagem VM",
            level: "ok",
            message: "Imagem VM resolvida por configuração do nó.",
            path: "C:\\workspace\\flows\\reference-interview\\images\\agent-flow-python.qcow2",
          },
        ],
      }),
    });
  });
  const vmCheckPanel = rightPanel.getByLabel("Verificação do runner VM");
  await expect(vmCheckPanel.getByRole("button", { name: "Exportar prontidão" })).toBeDisabled();
  await vmCheckPanel.getByRole("button", { name: "Verificar runner VM" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Runner VM pronto");
  await expect(vmCheckPanel).toContainText("Runner e imagem VM prontos");
  await expect(vmCheckPanel).toContainText("agent-flow-vm-runner.v1");
  await expect(vmCheckPanel).toContainText("executa código do usuário: não");
  await expect(vmCheckPanel).toContainText("python-qemu-microvm");
  const vmReadinessDownloadPromise = page.waitForEvent("download");
  await vmCheckPanel.getByRole("button", { name: "Exportar prontidão" }).click();
  const vmReadinessDownload = await vmReadinessDownloadPromise;
  expect(vmReadinessDownload.suggestedFilename()).toBe(
    "vm-runner-readiness-reference-interview-deterministic_gate.afvmreadiness.json",
  );
  const vmReadinessPath = await vmReadinessDownload.path();
  expect(vmReadinessPath).toBeTruthy();
  const vmReadinessText = await fs.readFile(vmReadinessPath, "utf-8");
  const vmReadinessFile = JSON.parse(vmReadinessText);
  expect(vmReadinessFile.format).toBe("agent-flow-builder.vm-runner-readiness.v1");
  expect(vmReadinessFile.status).toBe("ready");
  expect(vmReadinessFile.executesUserCode).toBe(false);
  expect(vmReadinessFile.runner).toMatchObject({
    value: "agent-flow-vm-runner",
    source: "node",
    resolved: true,
    args: ["--engine", "qemu"],
  });
  expect(vmReadinessFile.image).toMatchObject({
    value: "images/agent-flow-python.qcow2",
    source: "node",
    resolved: true,
  });
  expect(vmReadinessFile.governance).toMatchObject({
    sourceFormat: "agent-flow-builder.vm-runner-check.v1",
    excludesResolvedLocalPaths: true,
    excludesUserCode: true,
    excludesSecretValues: true,
    excludesEnvValues: true,
    executesUserCode: false,
  });
  expect(vmReadinessFile.governance.localPathCountExcluded).toBe(4);
  expect(vmReadinessText).not.toContain(String.raw`C:\tools`);
  expect(vmReadinessText).not.toContain(String.raw`C:\workspace`);
  expect(vmReadinessText).not.toContain("path");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Nome do perfil de sandbox reutilizável");
    await dialog.accept("VM gerenciada");
  });
  await sandboxLibrary.getByRole("button", { name: "Salvar perfil" }).click();
  const [vmProfileDownload] = await Promise.all([
    page.waitForEvent("download"),
    sandboxLibrary.getByRole("button", { name: "Exportar" }).click(),
  ]);
  const vmProfilePath = await vmProfileDownload.path();
  expect(vmProfilePath).toBeTruthy();
  const vmProfileFile = JSON.parse(await fs.readFile(vmProfilePath, "utf-8"));
  const vmProfile = vmProfileFile.profiles.find((profile) => profile.name === "VM gerenciada");
  expect(vmProfile.sandboxIsolation).toBe("vm");
  expect(vmProfile.sandboxVmImageId).toBe("python-qemu-microvm");
  expect(vmProfile.sandboxVmImage).toBe("images/agent-flow-python.qcow2");
  expect(vmProfile.sandboxVmArgs).toEqual(["--engine", "qemu"]);

  await expectNoDocumentHorizontalOverflow(page);
  expect(pageErrors, "Unexpected browser errors while using code sandbox policy library").toEqual([]);
});

test("node debug path exposes graph neighbors and opens Studio", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await openBuilder(page, "light", viewports[0]);

  await page.locator(".canvas-node-chip", { hasText: "input_safety_check" }).click();
  const debugPanel = page.getByLabel("Debug guiado do nó");
  const nodePath = debugPanel.getByLabel("Caminho do nó");
  await expect(nodePath).toContainText("Upstream");
  await expect(nodePath).toContainText("start");
  await expect(nodePath).toContainText("Downstream");
  await expect(nodePath).toContainText("llm_step");
  await expect(nodePath).toContainText("safety.decision == 'allow'");
  await expect(nodePath).toContainText("safety.blocked == true");

  await nodePath.getByRole("button", { name: /llm_step/ }).click();
  await expect(page.locator(".tabs button", { hasText: "Studio" })).toHaveClass(/active/);
  await expect(page.locator("footer[role='status']")).toContainText("Studio aberto para llm_step");
  await expectNoDocumentHorizontalOverflow(page);
  expect(pageErrors, "Unexpected browser errors while using node debug path").toEqual([]);
});

test("canvas batch editor updates advanced node families", async ({ page }, testInfo) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await openBuilder(page, "light", viewports[0]);

  const createdIds = [];
  for (const paletteLabel of ["Transform", "DB Query", "DB Save", "Arquivo", "RAG", "Approval", "Scoring", "Analytics"]) {
    await page.locator(".palette-item", { hasText: paletteLabel }).click();
    await expect(page.locator("footer[role='status']")).toContainText("criado");
    const nodeId = await page.locator(".react-flow__node.selected").getAttribute("data-id");
    expect(nodeId).toBeTruthy();
    createdIds.push(nodeId);
  }

  await page.locator(".canvas-node-chip", { hasText: createdIds[0] }).click();
  await page.keyboard.down("Shift");
  for (const nodeId of createdIds.slice(1)) {
    await page.locator(".canvas-node-chip", { hasText: nodeId }).click();
  }
  await page.keyboard.up("Shift");

  const batchEditor = page.getByLabel("Edição em lote da seleção");
  await expect(batchEditor).toContainText("8 nós selecionados");
  await expect(batchEditor).toContainText("1 query");
  await expect(batchEditor).toContainText("1 save");
  await expect(batchEditor).toContainText("1 arquivo");
  await expect(batchEditor).toContainText("1 RAG");

  await batchEditor.getByLabel("Input path transform em lote").fill("payload.raw");
  await batchEditor.getByRole("button", { name: "Usar input transform" }).click();
  await batchEditor.getByLabel("Output path transform em lote").fill("payload.normalized");
  await batchEditor.getByRole("button", { name: "Usar output transform" }).click();

  await batchEditor.getByLabel("SQL banco em lote").fill("select * from agent_node_records where session_id = :session_id");
  await batchEditor.getByRole("button", { name: "Usar SQL banco" }).click();
  await batchEditor.getByLabel("Tabela save em lote").fill("agent_node_records");
  await batchEditor.getByRole("button", { name: "Usar tabela save" }).click();
  await batchEditor.getByLabel("Params path query em lote").fill("database.params");
  await batchEditor.getByRole("button", { name: "Usar params query" }).click();
  await batchEditor.getByLabel("Data path save em lote").fill("database.row");
  await batchEditor.getByRole("button", { name: "Usar data save" }).click();
  await batchEditor.getByLabel("Result path banco em lote").fill("database.batch");
  await batchEditor.getByRole("button", { name: "Usar result banco" }).click();
  await batchEditor.getByLabel("Max rows query em lote").fill("25");
  await batchEditor.getByRole("button", { name: "Usar max rows" }).click();

  await batchEditor.getByLabel("Source path arquivo em lote").fill("knowledge/product.md");
  await batchEditor.getByRole("button", { name: "Usar source arquivo" }).click();
  await batchEditor.getByLabel("Content path arquivo em lote").fill("documents.content");
  await batchEditor.getByRole("button", { name: "Usar content arquivo" }).click();
  await batchEditor.getByLabel("Max chars arquivo em lote").fill("12000");
  await batchEditor.getByRole("button", { name: "Usar max chars" }).click();
  await batchEditor.getByLabel("Collection path RAG em lote").fill("knowledge");
  await batchEditor.getByRole("button", { name: "Usar collection RAG" }).click();
  await batchEditor.getByLabel("Query path RAG em lote").fill("user_message");
  await batchEditor.getByRole("button", { name: "Usar query RAG" }).click();
  await batchEditor.getByLabel("Context path RAG em lote").fill("rag.context");
  await batchEditor.getByRole("button", { name: "Usar context RAG" }).click();
  await batchEditor.getByLabel("Top K RAG em lote").fill("4");
  await batchEditor.getByRole("button", { name: "Usar top K" }).click();

  await batchEditor.getByLabel("Decision path approval em lote").fill("approval.decision");
  await batchEditor.getByRole("button", { name: "Usar decision approval" }).click();
  await batchEditor.getByLabel("Approval value em lote").fill("approved");
  await batchEditor.getByRole("button", { name: "Usar valor aprovado" }).click();
  await batchEditor.getByLabel("Rejection value em lote").fill("rejected");
  await batchEditor.getByRole("button", { name: "Usar valor rejeitado" }).click();
  await batchEditor.getByLabel("Result path approval em lote").fill("approvals.batch");
  await batchEditor.getByRole("button", { name: "Usar result approval" }).click();
  await batchEditor.getByLabel("Input path scoring em lote").fill("payload.answer");
  await batchEditor.getByRole("button", { name: "Usar input scoring" }).click();
  await batchEditor.getByLabel("Result path scoring em lote").fill("scores.batch");
  await batchEditor.getByRole("button", { name: "Usar result scoring" }).click();
  await batchEditor.getByLabel("Threshold scoring em lote").fill("0.8");
  await batchEditor.getByRole("button", { name: "Usar threshold" }).click();
  await batchEditor.getByLabel("Metric name analytics em lote").fill("turn_completed");
  await batchEditor.getByRole("button", { name: "Usar métrica analytics" }).click();
  await batchEditor.getByLabel("Payload path analytics em lote").fill("payload.metrics");
  await batchEditor.getByRole("button", { name: "Usar payload analytics" }).click();
  await batchEditor.getByLabel("Result path analytics em lote").fill("analytics.batch");
  await batchEditor.getByRole("button", { name: "Usar result analytics" }).click();

  await batchEditor.getByLabel("Nome do preset de edição em lote").fill("Perfil avançado");
  await batchEditor.getByRole("button", { name: "Salvar preset" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Preset Perfil avançado salvo");
  await batchEditor.getByRole("button", { name: "Salvar biblioteca" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Preset Perfil avançado salvo na biblioteca");
  await expect(batchEditor).toContainText("1 preset na biblioteca");
  const [presetLibraryDownload] = await Promise.all([
    page.waitForEvent("download"),
    batchEditor.getByRole("button", { name: "Exportar biblioteca" }).click(),
  ]);
  expect(presetLibraryDownload.suggestedFilename()).toBe("canvas-batch-presets.afbatchpresets.json");
  const presetLibraryPath = await presetLibraryDownload.path();
  if (!presetLibraryPath) {
    throw new Error("Preset library download path was not available.");
  }
  const presetLibraryPackage = JSON.parse(await fs.readFile(presetLibraryPath, "utf-8"));
  expect(presetLibraryPackage.format).toBe("agent-flow-builder.canvas-batch-presets.v1");
  expect(presetLibraryPackage.presets).toHaveLength(1);
  expect(presetLibraryPackage.presets[0].name).toBe("Perfil avançado");
  presetLibraryPackage.presets[0].id = "batch-library-preset-imported";
  presetLibraryPackage.presets[0].name = "Perfil importado";
  const importPresetLibraryPath = testInfo.outputPath("canvas-batch-presets.afbatchpresets.json");
  await fs.writeFile(importPresetLibraryPath, `${JSON.stringify(presetLibraryPackage, null, 2)}\n`);
  await batchEditor.locator(".batch-preset-import-input").setInputFiles(importPresetLibraryPath);
  await expect(page.locator("footer[role='status']")).toContainText("Biblioteca de presets importada: 1 preset(s); 2 preset(s) na biblioteca");
  await expect(batchEditor).toContainText("2 presets na biblioteca");

  const rightPanel = page.locator(".right-panel");
  const nodeLabel = (labelText) => rightPanel.locator(".edit-group label", { hasText: labelText });
  await page.locator(".canvas-node-chip", { hasText: createdIds[0] }).click();
  await expect(nodeLabel("Input path").locator("input")).toHaveValue("payload.raw");
  await expect(nodeLabel("Output path").locator("input")).toHaveValue("payload.normalized");

  await page.locator(".canvas-node-chip", { hasText: createdIds[1] }).click();
  await expect(nodeLabel("Query SQL").locator("textarea")).toHaveValue("select * from agent_node_records where session_id = :session_id");
  await expect(nodeLabel("Params path").locator("input")).toHaveValue("database.params");
  await expect(nodeLabel("Result path").locator("input")).toHaveValue("database.batch");

  await page.locator(".canvas-node-chip", { hasText: createdIds[2] }).click();
  await expect(nodeLabel("Tabela").locator("input")).toHaveValue("agent_node_records");
  await expect(nodeLabel("Data path").locator("input")).toHaveValue("database.row");
  await expect(nodeLabel("Result path").locator("input")).toHaveValue("database.batch");

  await page.locator(".canvas-node-chip", { hasText: createdIds[3] }).click();
  await expect(nodeLabel("Source path").locator("input")).toHaveValue("knowledge/product.md");
  await expect(nodeLabel("Content path").locator("input")).toHaveValue("documents.content");
  await expect(nodeLabel("Max chars").locator("input")).toHaveValue("12000");

  await page.locator(".canvas-node-chip", { hasText: createdIds[4] }).click();
  await expect(nodeLabel("Collection path").locator("input")).toHaveValue("knowledge");
  await expect(nodeLabel("Query path").locator("input")).toHaveValue("user_message");
  await expect(nodeLabel("Context path").locator("input")).toHaveValue("rag.context");
  await expect(nodeLabel("Top K").locator("input")).toHaveValue("4");

  await page.locator(".canvas-node-chip", { hasText: createdIds[5] }).click();
  await expect(nodeLabel("Decision path").locator("input")).toHaveValue("approval.decision");
  await expect(nodeLabel("Approval value").locator("input")).toHaveValue("approved");
  await expect(nodeLabel("Rejection value").locator("input")).toHaveValue("rejected");
  await expect(nodeLabel("Result path").locator("input")).toHaveValue("approvals.batch");

  await page.locator(".canvas-node-chip", { hasText: createdIds[6] }).click();
  await expect(nodeLabel("Input path").locator("input")).toHaveValue("payload.answer");
  await expect(nodeLabel("Result path").locator("input")).toHaveValue("scores.batch");
  await expect(nodeLabel("Threshold").locator("input")).toHaveValue("0.8");

  await page.locator(".canvas-node-chip", { hasText: createdIds[7] }).click();
  await expect(nodeLabel("Metric name").locator("input")).toHaveValue("turn_completed");
  await expect(nodeLabel("Payload path").locator("input")).toHaveValue("payload.metrics");
  await expect(nodeLabel("Result path").locator("input")).toHaveValue("analytics.batch");

  const presetTargetIds = [];
  for (const paletteLabel of ["Transform", "DB Query"]) {
    await page.locator(".palette-item", { hasText: paletteLabel }).click();
    await expect(page.locator("footer[role='status']")).toContainText("criado");
    const nodeId = await page.locator(".react-flow__node.selected").getAttribute("data-id");
    expect(nodeId).toBeTruthy();
    presetTargetIds.push(nodeId);
  }
  await page.locator(".canvas-node-chip", { hasText: presetTargetIds[0] }).click();
  await page.keyboard.down("Shift");
  await page.locator(".canvas-node-chip", { hasText: presetTargetIds[1] }).click();
  await page.keyboard.up("Shift");

  const presetBatchEditor = page.getByLabel("Edição em lote da seleção");
  const presetSelect = presetBatchEditor.getByLabel("Preset salvo de edição em lote");
  const presetOptionValue = await presetSelect.locator('option[value^="library:"]', { hasText: "Perfil importado" }).getAttribute("value");
  expect(presetOptionValue).toBeTruthy();
  await presetSelect.selectOption(presetOptionValue);
  const presetGovernance = presetBatchEditor.getByLabel("Governança do preset selecionado");
  await expect(presetGovernance).toContainText("Biblioteca local");
  await expect(presetGovernance).toContainText("database_query");
  await expect(presetGovernance).toContainText("reference-interview");
  await expect(presetGovernance).toContainText("nunca");
  await presetBatchEditor.getByRole("button", { name: "Aplicar preset" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Preset Perfil importado aplicado");
  await expect(presetGovernance.locator("div", { hasText: "Usos" })).toContainText("1");
  await expect(presetGovernance.locator("div", { hasText: "Nós no último uso" })).toContainText("2");

  await page.locator(".canvas-node-chip", { hasText: presetTargetIds[0] }).click();
  await expect(nodeLabel("Input path").locator("input")).toHaveValue("payload.raw");
  await expect(nodeLabel("Output path").locator("input")).toHaveValue("payload.normalized");
  await page.locator(".canvas-node-chip", { hasText: presetTargetIds[1] }).click();
  await expect(nodeLabel("Query SQL").locator("textarea")).toHaveValue("select * from agent_node_records where session_id = :session_id");
  await expect(nodeLabel("Params path").locator("input")).toHaveValue("database.params");
  await expect(nodeLabel("Result path").locator("input")).toHaveValue("database.batch");

  await expectNoDocumentHorizontalOverflow(page);
  expect(pageErrors, "Unexpected browser errors while editing advanced batch fields").toEqual([]);
});

test("agent overview summarizes completion and routes next action", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await page.route(`${apiUrl}/flows/reference-interview/validate`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "error",
        id: "reference-interview",
        name: "Agente de Referência",
        version: "0.1.0",
        nodes: 8,
        edges: 8,
        contract: "sessions-v1",
        diagnostics: [
          {
            severity: "error",
            code: "ui_audit_missing_prompt",
            message: "Prompt ausente no nó llm_step.",
            path: "nodes[4].promptId",
            nodeId: "llm_step",
          },
        ],
        summary: {
          nodes: 8,
          edges: 8,
          prompts: 1,
          schemas: 1,
          errors: 1,
          warnings: 0,
          infos: 0,
        },
      }),
    });
  });

  await openBuilder(page, "light", viewports[0]);
  await openInspectorTab(page, "Visão");

  await expect(page.getByText("Roteiro de criação")).toBeVisible();
  const creationRoadmap = page.getByLabel("Roteiro de criação do agente");
  await expect(creationRoadmap).toContainText("Entrada e objetivo");
  await expect(creationRoadmap).toContainText("Instruções e IA");
  await expect(creationRoadmap).toContainText("Conhecimento e ferramentas");
  await expect(creationRoadmap).toContainText("Controle e safety");
  await expect(creationRoadmap).toContainText("Estado e saída");
  await expect(creationRoadmap).toContainText("Teste, aprovação e API");
  await expect(creationRoadmap).toContainText("Evidência final nasce no Studio Local antes da API Docker");
  await expect(page.getByText("Fluxo principal")).toBeVisible();
  const flowMap = page.getByLabel("Mapa visual do fluxo");
  await expect(flowMap).toContainText("API /sessions");
  await expect(flowMap).toContainText("input_safety_check");
  await expect(flowMap).toContainText("llm_step");
  await flowMap.getByRole("button", { name: /llm_step/ }).click();
  await expect(page.locator(".tabs button", { hasText: "Editar" })).toHaveClass(/active/);
  await expect(page.locator(".react-flow__node.selected")).toContainText("llm_step");
  await openInspectorTab(page, "Visão");
  await expect(page.getByText("Canais e subagentes")).toBeVisible();
  const channelMap = page.getByLabel("Status de canais e subagentes");
  await expect(channelMap).toContainText("reference-interview");
  await expect(channelMap).toContainText("/reference-interview");
  const channelDetails = page.getByLabel("Detalhes de canais e subagentes");
  await expect(channelDetails).toContainText("Flow path");
  await expect(channelDetails).toContainText("flows/reference-interview/agent.flow.json");
  await expect(channelDetails).toContainText("Runtime");
  await expect(channelDetails).toContainText("agents/reference-interview");
  await expect(channelDetails).toContainText("Metadata");
  await expect(channelDetails).toContainText("/reference-interview/metadata");
  await expect(channelDetails).toContainText("Endpoint de sessões");
  await expect(channelDetails).toContainText("pendente de validação");
  await expect(channelDetails).toContainText("Contrato");
  await expect(channelDetails).toContainText("pendente");
  await expect(channelDetails).toContainText("Valide o manifesto para resolver flow, contrato e resourceName");
  await channelMap.getByRole("button", { name: /reference-interview/ }).click();
  await expect(page.locator(".tabs button", { hasText: "Runtime" })).toHaveClass(/active/);
  await openInspectorTab(page, "Visão");
  await expect(page.getByText("Mapa de completude")).toBeVisible();
  await expect(page.getByText("Entrada e contrato HTTP")).toBeVisible();
  await expect(page.getByText("Instruções e LLM")).toBeVisible();
  await expect(page.getByText("Estado, schemas e saída")).toBeVisible();
  await expect(page.getByText("Configuração guiada")).toBeVisible();
  const guidedConfig = page.getByLabel("Configuração guiada do agente");
  await expect(guidedConfig).toContainText("Refinar etapa de IA");
  await expect(guidedConfig).toContainText("Expandir ferramentas");
  await expect(guidedConfig).toContainText("Adicionar ferramenta");
  await expect(page.getByText("Ações sugeridas")).toBeVisible();
  await expect(page.locator(".overview-issue-list")).toContainText("Validação e evidência local");
  await expect(page.getByLabel("Resumo do agente")).toContainText("Nós");
  await page.locator(".overview-section", { hasText: "Próxima melhor ação" }).getByRole("button", { name: "Validar flow" }).click();
  await expect(page.locator(".tabs button", { hasText: "Validação" })).toHaveClass(/active/);
  await expect(page.locator("footer[role='alert']")).toContainText("Agente de Referência", { timeout: 10_000 });
  await openInspectorTab(page, "Visão");
  await expect(page.getByLabel("Roteiro de criação do agente")).toContainText("Há bloqueios antes do sandbox");
  await expect(page.locator(".overview-issue-list")).toContainText("ui_audit_missing_prompt");
  await page.locator(".overview-issue", { hasText: "ui_audit_missing_prompt" }).click();
  await expect(page.locator(".tabs button", { hasText: "Editar" })).toHaveClass(/active/);
  await expect(page.locator(".react-flow__node.selected")).toContainText("llm_step");
  await openInspectorTab(page, "Visão");
  await page.getByLabel("Configuração guiada do agente").getByRole("button", { name: /Expandir ferramentas/ }).click();
  await expect(page.locator(".tabs button", { hasText: "Editar" })).toHaveClass(/active/);
  await expect(page.locator(".react-flow__node.selected")).toContainText("code_");
  await expect(page.locator("footer[role='status']")).toContainText("criado");

  expect(pageErrors, "Unexpected browser errors while using agent overview").toEqual([]);
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
  const schemaConsistency = page.getByLabel("Consistência do schema");
  const schemaGovernance = page.getByRole("region", { name: "Governança do schema" });
  await expect(schemaConsistency).toContainText("Schema consistente");
  await expect(schemaGovernance).toContainText("Governança do schema");
  await expect(schemaGovernance).toContainText("Padrões aplicados");
  await expect(page.getByRole("button", { name: /Mensagem de conversa/ })).toContainText("2 adição(ões)");
  await expect(page.getByRole("button", { name: /Mensagem de conversa/ })).toContainText("Novos: messages, $defs.ConversationMessage");
  await page.getByRole("button", { name: /Mensagem de conversa/ }).click();
  await expect(schemaConsistency).toContainText("Schema consistente");
  await expect(schemaGovernance).toContainText("Mensagem de conversa");
  await expect(page.locator(".schema-editor")).toHaveValue(/"ConversationMessage": \{/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"messages": \{\s+"type": "array"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"\$ref": "#\/\$defs\/ConversationMessage"/);
  await page.getByLabel("$ref de schema").fill("#/$defs/SessionState");
  await expect(schemaConsistency).toContainText("Referência local não encontrada: #/$defs/SessionState");
  await page.getByRole("button", { name: "Ir para schema.$ref" }).click();
  await expect(page.getByLabel("$ref de schema")).toBeFocused();
  await page.getByRole("button", { name: "Criar $defs.SessionState" }).click();
  await expect(schemaConsistency).toContainText("Schema consistente");
  await page.getByLabel("additionalProperties de schema").selectOption("schema");
  await page.getByLabel("Tipo de additionalProperties de schema").selectOption("string");
  await page.getByRole("button", { name: "Adicionar oneOf em schema" }).click();
  await page.getByRole("button", { name: "Adicionar anyOf em schema" }).click();
  await page.getByLabel("$ref de status").fill("#/$defs/Status");
  await expect(schemaConsistency).toContainText("Referência local não encontrada: #/$defs/Status");
  await page.getByRole("button", { name: "Ir para schema.properties.status.$ref" }).click();
  await expect(page.getByLabel("$ref de status")).toBeFocused();
  await page.getByRole("button", { name: "Criar $defs.Status" }).click();
  await expect(schemaConsistency).toContainText("Schema consistente");
  await page.getByLabel("Nome da propriedade em $defs.SessionState", { exact: true }).fill("state_id");
  await page.getByLabel("Tipo da nova propriedade em $defs.SessionState", { exact: true }).selectOption("string");
  await page.getByRole("button", { name: "Adicionar propriedade em $defs.SessionState" }).click();
  await page.getByLabel("Descrição de $defs.SessionState.state_id").fill("Identificador interno do estado.");
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
  await page.getByLabel("Tipo da nova propriedade", { exact: true }).selectOption("number");
  await page.getByRole("button", { name: /^Adicionar$/ }).click();
  await expect(page.locator(".schema-editor")).toHaveValue(/"review_score"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"user_message"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"archived"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"\$ref": "#\/\$defs\/SessionState"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"additionalProperties": \{\s+"type": "string"\s+\}/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"oneOf": \[/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"anyOf": \[/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"\$ref": "#\/\$defs\/Status"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"\$defs": \{/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"SessionState": \{\s+"type": "object"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"state_id"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"Status": \{\s+"type": "string"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"items": \{\s+"type": "string"\s+\}/);
  const [schemaGovernanceDownload] = await Promise.all([
    page.waitForEvent("download"),
    schemaGovernance.getByRole("button", { name: /^Exportar governança do schema$/ }).click(),
  ]);
  expect(schemaGovernanceDownload.suggestedFilename()).toMatch(/^schema-governance-reference-interview-.*\.afschemagovernance\.json$/);
  const schemaGovernancePath = await schemaGovernanceDownload.path();
  expect(schemaGovernancePath).toBeTruthy();
  const schemaGovernanceFile = JSON.parse(await fs.readFile(schemaGovernancePath, "utf-8"));
  expect(schemaGovernanceFile.format).toBe("agent-flow-builder.schema-governance.v1");
  expect(schemaGovernanceFile.flow.id).toBe("reference-interview");
  expect(schemaGovernanceFile.schema.id).toBe("session_state");
  expect(schemaGovernanceFile.summary.propertyCount).toBeGreaterThan(0);
  expect(schemaGovernanceFile.patterns.applied.some((pattern) => pattern.id === "conversation-message")).toBe(true);
  expect(schemaGovernanceFile.diagnostics.errorCount).toBe(0);
  expect(schemaGovernanceFile.governance.excludesRawSchemaContent).toBe(true);
  expect(schemaGovernanceFile.governance.excludesSecretValues).toBe(true);
  const schemaPatterns = page.getByLabel("Padrões reutilizáveis de schema");
  await schemaPatterns.getByLabel("Nome do padrão local de schema").fill("Sessão entrevista enriquecida");
  await schemaPatterns.getByLabel("Tags do padrão local de schema").fill("estado, entrevista");
  await schemaPatterns.getByLabel("Descrição do padrão local de schema").fill("Contrato reutilizável para sessão guiada.");
  await schemaPatterns.getByRole("button", { name: /^Salvar padrão$/ }).click();
  await expect(schemaPatterns).toContainText('Padrão local "Sessão entrevista enriquecida" salvo.');
  const storedSchemaPatternLibrary = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("agent-flow-builder.schema-pattern-library.v1") || "null"),
  );
  expect(storedSchemaPatternLibrary.format).toBe("agent-flow-builder.schema-pattern-library.v1");
  expect(storedSchemaPatternLibrary.itemCount).toBe(1);
  expect(storedSchemaPatternLibrary.items[0].name).toBe("Sessão entrevista enriquecida");
  expect(storedSchemaPatternLibrary.items[0].curationStatus).toBe("draft");
  expect(storedSchemaPatternLibrary.items[0].usageCount).toBe(0);
  expect(storedSchemaPatternLibrary.items[0].schemaHash).toMatch(/^[a-f0-9]{8}$/);
  expect(storedSchemaPatternLibrary.items[0].schema.properties.messages).toBeTruthy();
  await expect(schemaPatterns).toContainText("Rascunho");
  await schemaPatterns.getByRole("button", { name: "Aprovar Sessão entrevista enriquecida" }).click();
  await expect(schemaPatterns).toContainText('Padrão local "Sessão entrevista enriquecida" aprovado.');
  const approvedSchemaPatternLibrary = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("agent-flow-builder.schema-pattern-library.v1") || "null"),
  );
  expect(approvedSchemaPatternLibrary.items[0].curationStatus).toBe("approved");
  expect(approvedSchemaPatternLibrary.items[0].reviewedBy).toBe("local-user");
  expect(approvedSchemaPatternLibrary.items[0].reviewedAt).toBeTruthy();
  const schemaPatternDownloadPromise = page.waitForEvent("download");
  await schemaPatterns.getByRole("button", { name: /^Exportar biblioteca$/ }).click();
  const schemaPatternDownload = await schemaPatternDownloadPromise;
  expect(schemaPatternDownload.suggestedFilename()).toBe("schema-pattern-library.afschemapatterns.json");
  const schemaPatternPath = await schemaPatternDownload.path();
  expect(schemaPatternPath).toBeTruthy();
  const schemaPatternFile = JSON.parse(await fs.readFile(schemaPatternPath, "utf-8"));
  expect(schemaPatternFile.format).toBe("agent-flow-builder.schema-pattern-library.v1");
  expect(schemaPatternFile.itemCount).toBe(1);
  expect(schemaPatternFile.items[0].curationStatus).toBe("approved");
  const importedSchemaPatternPackage = {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: "2026-07-02T00:00:00.000Z",
    itemCount: 1,
    items: [
      {
        id: "schema-pattern-review-package",
        name: "Pacote revisão humana",
        description: "Campos para revisão humana e auditoria de resultado.",
        tags: ["review", "human"],
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
        schemaHash: "ignored",
        summary: {
          propertyCount: 2,
          requiredCount: 1,
          definitionCount: 1,
          refCount: 1,
          enumCount: 0,
          enumValueCount: 0,
          objectCount: 2,
          arrayCount: 0,
          compositionCount: 0,
          openAdditionalPropertiesCount: 0,
          lockedAdditionalPropertiesCount: 1,
          schemaAdditionalPropertiesCount: 0,
          maxDepth: 1,
        },
        schema: {
          type: "object",
          required: ["review_notes"],
          properties: {
            review_notes: { type: "string", description: "Notas do revisor humano." },
            review_meta: { $ref: "#/$defs/ReviewMeta" },
          },
          $defs: {
            ReviewMeta: {
              type: "object",
              properties: {
                reviewer: { type: "string" },
                reviewed_at: { type: "string" },
              },
              additionalProperties: false,
            },
          },
        },
      },
    ],
  };
  await schemaPatterns.getByLabel("Importar biblioteca de padrões de schema").setInputFiles({
    name: "schema-pattern-library.afschemapatterns.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedSchemaPatternPackage), "utf-8"),
  });
  await expect(schemaPatterns).toContainText("1 padrão(ões) importado(s).");
  await expect(schemaPatterns).toContainText("4 adição(ões)");
  await expect(schemaPatterns).toContainText("Novos: review_notes, review_meta, $defs.ReviewMeta");
  await expect(schemaPatterns).toContainText("Sem conflitos de nomes");
  await schemaPatterns.getByRole("button", { name: /^Salvar snapshot$/ }).click();
  await expect(schemaPatterns).toContainText("Snapshot de padrões salvo (2 padrão(ões)).");
  const schemaPatternHistory = page.getByRole("region", { name: "Histórico de padrões de schema" });
  await expect(schemaPatternHistory).toContainText("1 snapshot(s)");
  await expect(schemaPatternHistory).toContainText("2 padrão(ões)");
  await expect(schemaPatternHistory).toContainText("Pacote revisão humana");
  const schemaPatternHistoryDownloadPromise = page.waitForEvent("download");
  await schemaPatterns.getByRole("button", { name: /^Exportar histórico$/ }).click();
  const schemaPatternHistoryDownload = await schemaPatternHistoryDownloadPromise;
  expect(schemaPatternHistoryDownload.suggestedFilename()).toBe("schema-pattern-history.afschemapatternhistory.json");
  const schemaPatternHistoryPath = await schemaPatternHistoryDownload.path();
  expect(schemaPatternHistoryPath).toBeTruthy();
  const schemaPatternHistoryFile = JSON.parse(await fs.readFile(schemaPatternHistoryPath, "utf-8"));
  expect(schemaPatternHistoryFile.format).toBe("agent-flow-builder.schema-pattern-library-history.v1");
  expect(schemaPatternHistoryFile.snapshotCount).toBe(1);
  expect(schemaPatternHistoryFile.governance.excludesRawSchemaContent).toBe(true);
  expect(schemaPatternHistoryFile.governance.excludesSecretValues).toBe(true);
  expect(schemaPatternHistoryFile.packageHash).toMatch(/^[a-f0-9]{8}$/);
  expect(schemaPatternHistoryFile.snapshots[0].itemCount).toBe(2);
  expect(schemaPatternHistoryFile.snapshots[0].snapshotHash).toMatch(/^[a-f0-9]{8}$/);
  expect(schemaPatternHistoryFile.snapshots[0].items.some((item) => item.name === "Pacote revisão humana")).toBe(true);
  expect(schemaPatternHistoryFile.snapshots[0].items[0].schema).toBeUndefined();
  expect(JSON.stringify(schemaPatternHistoryFile)).not.toContain("Notas do revisor humano");
  await schemaPatterns.getByLabel("Importar histórico de padrões de schema").setInputFiles({
    name: "schema-pattern-history.afschemapatternhistory.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(schemaPatternHistoryFile), "utf-8"),
  });
  await expect(schemaPatterns).toContainText("1 snapshot(s) histórico(s) importado(s).");
  const schemaPatternDiffDownloadPromise = page.waitForEvent("download");
  await schemaPatterns.getByRole("button", { name: "Exportar diff Pacote revisão humana" }).click();
  const schemaPatternDiffDownload = await schemaPatternDiffDownloadPromise;
  expect(schemaPatternDiffDownload.suggestedFilename()).toMatch(/^schema-pattern-diff-pacote-revis-o-humana-[a-f0-9]+\.afschemapatterndiff\.json$/);
  const schemaPatternDiffPath = await schemaPatternDiffDownload.path();
  expect(schemaPatternDiffPath).toBeTruthy();
  const schemaPatternDiffFile = JSON.parse(await fs.readFile(schemaPatternDiffPath, "utf-8"));
  expect(schemaPatternDiffFile.format).toBe("agent-flow-builder.schema-pattern-application-diff.v1");
  expect(schemaPatternDiffFile.pattern.id).toBe("schema-pattern-review-package");
  expect(schemaPatternDiffFile.preview.propertyAdditions).toEqual(["review_notes", "review_meta"]);
  expect(schemaPatternDiffFile.preview.definitionAdditions).toEqual(["ReviewMeta"]);
  expect(schemaPatternDiffFile.governance.excludesRawSchemaContent).toBe(true);
  expect(schemaPatternDiffFile.governance.excludesSecretValues).toBe(true);
  expect(schemaPatternDiffFile.packageHash).toMatch(/^[a-f0-9]{8}$/);
  await schemaPatterns.getByLabel("Importar diff de padrão de schema").setInputFiles({
    name: "schema-pattern-diff.afschemapatterndiff.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(schemaPatternDiffFile), "utf-8"),
  });
  await expect(schemaPatterns).toContainText('Diff "Pacote revisão humana" importado para revisão.');
  const importedDiffReview = page.getByLabel("Revisão de diff de padrão de schema");
  await expect(importedDiffReview).toContainText("Compatível com o schema atual");
  await expect(importedDiffReview).toContainText("Hash verificado");
  await expect(importedDiffReview).toContainText("Pacote revisão humana");
  await expect(importedDiffReview).toContainText("4 adição(ões)");
  await expect(importedDiffReview).toContainText("Sem conflitos de nomes.");
  await importedDiffReview.getByRole("button", { name: "Fechar diff" }).click();
  await expect(page.getByLabel("Revisão de diff de padrão de schema")).toHaveCount(0);
  await schemaPatterns.getByLabel("Importar diff de padrão de schema").setInputFiles({
    name: "schema-pattern-diff-tampered.afschemapatterndiff.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...schemaPatternDiffFile, packageHash: "00000000" }), "utf-8"),
  });
  const tamperedDiffReview = page.getByLabel("Revisão de diff de padrão de schema");
  await expect(tamperedDiffReview).toContainText("Hash divergente");
  await expect(tamperedDiffReview).toContainText(`Hash recalculado: ${schemaPatternDiffFile.packageHash}`);
  await tamperedDiffReview.getByRole("button", { name: "Fechar diff" }).click();
  await expect(page.getByLabel("Revisão de diff de padrão de schema")).toHaveCount(0);
  await schemaPatterns.getByRole("button", { name: "Aplicar Pacote revisão humana" }).click();
  await expect(schemaPatterns).toContainText('Padrão local "Pacote revisão humana" aplicado.');
  const appliedSchemaPatternLibrary = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("agent-flow-builder.schema-pattern-library.v1") || "null"),
  );
  const appliedReviewPattern = appliedSchemaPatternLibrary.items.find((item) => item.id === "schema-pattern-review-package");
  expect(appliedReviewPattern.curationStatus).toBe("draft");
  expect(appliedReviewPattern.usageCount).toBe(1);
  expect(appliedReviewPattern.lastUsedAt).toBeTruthy();
  await schemaPatterns.getByRole("button", { name: /^Salvar snapshot$/ }).click();
  await expect(schemaPatterns).toContainText("2 snapshot(s)");
  await expect(schemaPatternHistory).toContainText("Comparação recente");
  await expect(schemaPatternHistory).toContainText("1 alterado(s)");
  await expect(schemaPatternHistory).toContainText("1 uso(s)");
  await schemaPatterns.getByRole("button", { name: /^Sincronizar compartilhado$/ }).click();
  await expect(schemaPatterns).toContainText("Biblioteca compartilhada sincronizada:");
  await expect(schemaPatterns).toContainText("Compartilhado: biblioteca sincronizada");
  const sharedSchemaPatternLibraryResponse = await page.request.get(`${apiUrl}/flows/reference-interview/schema-pattern-library`);
  expect(sharedSchemaPatternLibraryResponse.ok()).toBe(true);
  const sharedSchemaPatternLibrary = await sharedSchemaPatternLibraryResponse.json();
  expect(sharedSchemaPatternLibrary.format).toBe("agent-flow-builder.schema-pattern-library.v1");
  expect(sharedSchemaPatternLibrary.itemCount).toBeGreaterThanOrEqual(2);
  expect(sharedSchemaPatternLibrary.sharedSync.action).toBe("merge");
  expect(sharedSchemaPatternLibrary.sharedSync.contentHash).toMatch(/^[a-f0-9]{8}$/);
  expect(sharedSchemaPatternLibrary.items.some((item) => item.id === "schema-pattern-review-package")).toBe(true);
  const sharedSchemaPatternHistoryResponse = await page.request.get(`${apiUrl}/flows/reference-interview/schema-pattern-history`);
  expect(sharedSchemaPatternHistoryResponse.ok()).toBe(true);
  const sharedSchemaPatternHistory = await sharedSchemaPatternHistoryResponse.json();
  expect(sharedSchemaPatternHistory.format).toBe("agent-flow-builder.schema-pattern-library-history.v1");
  expect(sharedSchemaPatternHistory.snapshotCount).toBeGreaterThanOrEqual(2);
  expect(sharedSchemaPatternHistory.sharedSync.action).toBe("merge");
  expect(sharedSchemaPatternHistory.sharedSync.governance.excludesRawSchemaContent).toBe(true);
  expect(sharedSchemaPatternHistory.governance.excludesRawSchemaContent).toBe(true);
  expect(JSON.stringify(sharedSchemaPatternHistory)).not.toContain("Notas do revisor humano");
  const conflictBasePattern = sharedSchemaPatternLibrary.items.find((item) => item.name === "Sessão entrevista enriquecida");
  expect(conflictBasePattern).toBeTruthy();
  const conflictingSchemaPatternLibraryResponse = await page.request.post(`${apiUrl}/flows/reference-interview/schema-pattern-library/merge`, {
    data: {
      format: "agent-flow-builder.schema-pattern-library.v1",
      exportedAt: "2026-07-02T00:12:00.000Z",
      items: [
        {
          ...conflictBasePattern,
          tags: ["estado", "entrevista", "remoto"],
          curationStatus: "deprecated",
          updatedAt: "2026-07-02T00:12:00.000Z",
        },
      ],
    },
  });
  expect(conflictingSchemaPatternLibraryResponse.ok()).toBe(true);
  const conflictingSchemaPatternLibrary = await conflictingSchemaPatternLibraryResponse.json();
  expect(conflictingSchemaPatternLibrary.openConflictCount).toBeGreaterThanOrEqual(1);
  expect(conflictingSchemaPatternLibrary.conflicts[0].existingSnapshot.schema).toBeUndefined();
  expect(conflictingSchemaPatternLibrary.conflicts[0].incomingSnapshot.schema).toBeUndefined();
  await schemaPatterns.getByRole("button", { name: /^Carregar compartilhado$/ }).click();
  await expect(schemaPatterns).toContainText("Biblioteca compartilhada carregada:");
  await expect(schemaPatterns).toContainText("histórico sincronizada");
  await expect(schemaPatterns).toContainText("Conflitos compartilhados: 1 aberto");
  await schemaPatterns.getByLabel("Nome do curador local de padrões de schema").fill("schema-curator");
  await schemaPatterns.getByRole("button", { name: /^Marcar resolvido$/ }).click();
  await expect(schemaPatterns).toContainText("resolvido por schema-curator");
  await expect(schemaPatterns).toContainText("Conflitos compartilhados: 0 aberto");
  await expect(schemaPatterns).toContainText("último por schema-curator");
  const resolvedSchemaPatternLibraryResponse = await page.request.get(`${apiUrl}/flows/reference-interview/schema-pattern-library`);
  expect(resolvedSchemaPatternLibraryResponse.ok()).toBe(true);
  const resolvedSchemaPatternLibrary = await resolvedSchemaPatternLibraryResponse.json();
  expect(resolvedSchemaPatternLibrary.openConflictCount).toBe(0);
  expect(resolvedSchemaPatternLibrary.conflicts[0].resolvedBy).toBe("schema-curator");
  const schemaPatternHistoryDiffDownloadPromise = page.waitForEvent("download");
  await schemaPatterns.getByRole("button", { name: /^Exportar diff histórico$/ }).click();
  const schemaPatternHistoryDiffDownload = await schemaPatternHistoryDiffDownloadPromise;
  expect(schemaPatternHistoryDiffDownload.suggestedFilename()).toBe("schema-pattern-history-diff.afschemapatternhistorydiff.json");
  const schemaPatternHistoryDiffPath = await schemaPatternHistoryDiffDownload.path();
  expect(schemaPatternHistoryDiffPath).toBeTruthy();
  const schemaPatternHistoryDiffFile = JSON.parse(await fs.readFile(schemaPatternHistoryDiffPath, "utf-8"));
  expect(schemaPatternHistoryDiffFile.format).toBe("agent-flow-builder.schema-pattern-library-history-diff.v1");
  expect(schemaPatternHistoryDiffFile.summary.changedCount).toBe(1);
  expect(schemaPatternHistoryDiffFile.summary.usageChangedCount).toBe(1);
  expect(schemaPatternHistoryDiffFile.changed[0].name).toBe("Pacote revisão humana");
  expect(schemaPatternHistoryDiffFile.changed[0].usageDelta).toBe(1);
  expect(schemaPatternHistoryDiffFile.governance.excludesRawSchemaContent).toBe(true);
  expect(schemaPatternHistoryDiffFile.governance.excludesSecretValues).toBe(true);
  expect(schemaPatternHistoryDiffFile.packageHash).toMatch(/^[a-f0-9]{8}$/);
  expect(JSON.stringify(schemaPatternHistoryDiffFile)).not.toContain("Notas do revisor humano");
  await schemaPatterns.getByLabel("Importar diff histórico de padrões de schema").setInputFiles({
    name: "schema-pattern-history-diff.afschemapatternhistorydiff.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(schemaPatternHistoryDiffFile), "utf-8"),
  });
  await expect(schemaPatterns).toContainText("Diff histórico de padrões importado para revisão.");
  const importedHistoryDiffReview = page.getByLabel("Revisão de diff histórico de padrões de schema");
  await expect(importedHistoryDiffReview).toContainText("Hash verificado");
  await expect(importedHistoryDiffReview).toContainText("1 alterado(s)");
  await expect(importedHistoryDiffReview).toContainText("Pacote revisão humana");
  await importedHistoryDiffReview.getByRole("button", { name: "Fechar diff histórico" }).click();
  await expect(page.getByLabel("Revisão de diff histórico de padrões de schema")).toHaveCount(0);
  await schemaPatterns.getByLabel("Importar diff histórico de padrões de schema").setInputFiles({
    name: "schema-pattern-history-diff-tampered.afschemapatternhistorydiff.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...schemaPatternHistoryDiffFile, packageHash: "00000000" }), "utf-8"),
  });
  const tamperedHistoryDiffReview = page.getByLabel("Revisão de diff histórico de padrões de schema");
  await expect(tamperedHistoryDiffReview).toContainText("Hash divergente");
  await expect(tamperedHistoryDiffReview).toContainText(`Hash recalculado: ${schemaPatternHistoryDiffFile.packageHash}`);
  await tamperedHistoryDiffReview.getByRole("button", { name: "Fechar diff histórico" }).click();
  await expect(page.getByLabel("Revisão de diff histórico de padrões de schema")).toHaveCount(0);
  await expect(page.locator(".schema-editor")).toHaveValue(/"review_notes"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"ReviewMeta"/);
  await expect(page.locator(".schema-editor")).toHaveValue(/"review_notes"/);
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

test("schema visual editor applies assisted structural repairs", async ({ page }) => {
  const pageErrors = attachBrowserErrorCollector(page);

  await openBuilder(page, "light", viewports[0]);
  await openInspectorTab(page, "Arquivos");

  const brokenSchema = {
    type: "object",
    required: "status",
    additionalProperties: "false",
    oneOf: { type: "string" },
    properties: {
      status: { type: "string", enum: "draft" },
      details: { type: "object", properties: "invalid" },
    },
  };
  const editor = page.locator(".schema-editor");
  await editor.fill(`${JSON.stringify(brokenSchema, null, 2)}\n`);

  const schemaConsistency = page.getByLabel("Consistência do schema");
  await expect(schemaConsistency).toContainText("required precisa ser uma lista");
  await expect(schemaConsistency).toContainText("additionalProperties precisa ser true, false ou um schema");
  await expect(schemaConsistency).toContainText("oneOf precisa ser uma lista de schemas");
  await expect(schemaConsistency).toContainText("enum precisa ser uma lista");
  await expect(schemaConsistency).toContainText("properties precisa ser um objeto");

  await page.getByRole("button", { name: "Converter required em lista" }).click();
  await page.getByRole("button", { name: "Corrigir additionalProperties" }).click();
  await page.getByRole("button", { name: "Converter oneOf em lista" }).click();
  await page.getByRole("button", { name: "Converter enum em lista" }).click();
  await page.getByRole("button", { name: "Inicializar properties" }).click();

  await expect(schemaConsistency).toContainText("Schema consistente");
  await expect(editor).toHaveValue(/"required": \[\s+"status"\s+\]/);
  await expect(editor).toHaveValue(/"additionalProperties": false/);
  await expect(editor).toHaveValue(/"oneOf": \[\s+\{\s+"type": "string"\s+\}\s+\]/);
  await expect(editor).toHaveValue(/"enum": \[\s+"draft"\s+\]/);
  await expect(editor).toHaveValue(/"details": \{\s+"type": "object",\s+"properties": \{\}/);

  await expectNoDocumentHorizontalOverflow(page);
  await expectTopbarControlsToFit(page);
  expect(pageErrors, "Unexpected browser errors while applying schema repairs").toEqual([]);
});

test("catalog panel saves local assets and applies a tool", async ({ page, request }, testInfo) => {
  const pageErrors = attachBrowserErrorCollector(page);
  const originalFlowResponse = await request.get(`${apiUrl}/flows/reference-interview`);
  await expectApiOk(originalFlowResponse, "load original reference flow before catalog test");
  const originalFlow = (await originalFlowResponse.json()).flow;
  const firstRevision = await request.post(`${apiUrl}/catalog/items`, {
    data: {
      kind: "prompt",
      id: "ui-audit-revision-prompt",
      name: "Prompt com histórico UI",
      description: "Prompt local para validar histórico visual.",
      tags: ["ui-audit", "history"],
      content: "Linha inicial para histórico.\n",
    },
  });
  await expectApiOk(firstRevision, "save first catalog revision for UI audit");
  const secondRevision = await request.post(`${apiUrl}/catalog/items`, {
    data: {
      kind: "prompt",
      id: "ui-audit-revision-prompt",
      name: "Prompt com histórico UI",
      version: "1.1.0",
      description: "Prompt local para validar histórico visual.",
      tags: ["ui-audit", "history"],
      content: "Linha revisada para histórico.\n",
    },
  });
  await expectApiOk(secondRevision, "save second catalog revision for UI audit");
  const conflictPrompt = await request.post(`${apiUrl}/catalog/items`, {
    data: {
      kind: "prompt",
      id: "ui-audit-conflict-prompt",
      name: "Prompt para conflito UI",
      description: "Prompt separado para validar conflito visual.",
      tags: ["ui-audit", "conflict"],
      content: "Linha local para conflito visual.\n",
    },
  });
  await expectApiOk(conflictPrompt, "save conflict catalog item for UI audit");

  await openBuilder(page, "light", viewports[0]);
  await page.locator(".canvas-node-chip", { hasText: "deterministic_gate" }).click();
  await openInspectorTab(page, "Catálogo");
  const catalogPanel = page.locator(".catalog-body");

  await expect(page.getByText("Catálogo local")).toBeVisible();
  const catalogLibraryGovernance = catalogPanel.getByRole("region", { name: "Governança da biblioteca do catálogo" });
  await expect(catalogLibraryGovernance).toContainText("Governança da biblioteca");
  await expect(catalogLibraryGovernance).toContainText("itens");
  const catalogLibraryGovernanceDownloadPromise = page.waitForEvent("download");
  await catalogLibraryGovernance.getByRole("button", { name: /^Exportar governança da biblioteca do catálogo$/ }).click();
  const catalogLibraryGovernanceDownload = await catalogLibraryGovernanceDownloadPromise;
  expect(catalogLibraryGovernanceDownload.suggestedFilename()).toMatch(
    /catalog-library-governance-.*\.afcataloglibrarygovernance\.json$/,
  );
  const catalogLibraryGovernanceExportPath = await catalogLibraryGovernanceDownload.path();
  expect(catalogLibraryGovernanceExportPath).toBeTruthy();
  const catalogLibraryGovernanceExport = JSON.parse(await fs.readFile(catalogLibraryGovernanceExportPath, "utf-8"));
  expect(catalogLibraryGovernanceExport.format).toBe("agent-flow-builder.catalog-library-governance.v1");
  expect(catalogLibraryGovernanceExport.summary.itemCount).toBeGreaterThan(0);
  expect(catalogLibraryGovernanceExport.items.some((item) => item.name === "HTTP JSON tool")).toBe(true);
  expect(catalogLibraryGovernanceExport.governance.excludesRawCatalogContent).toBe(true);
  expect(catalogLibraryGovernanceExport.governance.excludesSecretValues).toBe(true);
  expect(catalogLibraryGovernanceExport.items[0].content).toBeUndefined();
  expect(catalogLibraryGovernanceExport.items[0].nodePatch).toBeUndefined();
  await expect(catalogPanel.getByText("Biblioteca compartilhada")).toBeVisible();
  await catalogPanel.getByRole("button", { name: /^Sincronizar compartilhado$/ }).click();
  await expect(catalogPanel).toContainText("Compartilhado: biblioteca sincronizada");
  const sharedCatalogResponse = await request.get(`${apiUrl}/catalog/shared-library`);
  await expectApiOk(sharedCatalogResponse, "load shared catalog library after UI sync");
  const sharedCatalog = await sharedCatalogResponse.json();
  expect(sharedCatalog.format).toBe("agent-flow-builder.catalog-library.v1");
  expect(sharedCatalog.itemCount).toBeGreaterThanOrEqual(1);
  expect(sharedCatalog.items.some((item) => item.id === "ui-audit-revision-prompt" && item.kind === "prompt")).toBe(true);
  expect(sharedCatalog.sharedSync.contentHash).toMatch(/^[a-f0-9]{12}$/);
  const sharedConflictPrompt = sharedCatalog.items.find((item) => item.id === "ui-audit-conflict-prompt" && item.kind === "prompt");
  expect(sharedConflictPrompt).toBeTruthy();
  const sharedConflictResponse = await request.post(`${apiUrl}/catalog/shared-library/merge`, {
    data: {
      format: "agent-flow-builder.catalog-library.v1",
      exportedAt: "2026-07-03T00:30:00.000Z",
      items: [
        {
          ...sharedConflictPrompt,
          name: "Prompt com conflito remoto UI",
          description: "Prompt remoto para validar conflito visual.",
          tags: ["ui-audit", "history", "remote"],
          version: "1.2.0",
          revision: 3,
          updatedAt: "2026-07-03T00:30:00.000Z",
          contentHash: "ui-audit-conflict",
          content: "Linha remota divergente para conflito visual.\n",
        },
      ],
    },
  });
  await expectApiOk(sharedConflictResponse, "merge conflicting shared catalog item for UI audit");
  const sharedConflictCatalog = await sharedConflictResponse.json();
  expect(sharedConflictCatalog.sharedLibrary.openConflictCount).toBe(1);
  await catalogPanel.getByRole("button", { name: /^Carregar compartilhado$/ }).click();
  await expect(catalogPanel).toContainText("Compartilhado: biblioteca carregada");
  await expect(catalogPanel.locator(".catalog-shared-conflicts")).toBeVisible();
  await expect(catalogPanel).toContainText("Prompt com conflito remoto UI");
  await expect(catalogPanel.getByRole("button", { name: /^Exportar revisão$/ })).toBeVisible();
  await expect(catalogPanel.getByRole("button", { name: /^Comparar revisão$/ })).toBeVisible();
  const catalogConflictReviewDownloadPromise = page.waitForEvent("download");
  await catalogPanel.getByRole("button", { name: /^Exportar revisão$/ }).click();
  const catalogConflictReviewDownload = await catalogConflictReviewDownloadPromise;
  expect(catalogConflictReviewDownload.suggestedFilename()).toMatch(
    /^catalog-conflicts-[a-f0-9]+\.afcatalog-conflicts\.json$/,
  );
  const catalogConflictReviewPath = await catalogConflictReviewDownload.path();
  expect(catalogConflictReviewPath).toBeTruthy();
  const catalogConflictReview = JSON.parse(await fs.readFile(catalogConflictReviewPath, "utf-8"));
  expect(catalogConflictReview.format).toBe("agent-flow-builder.catalog-conflict-review.v1");
  expect(catalogConflictReview.openConflictCount).toBe(1);
  expect(catalogConflictReview.summary.promptConflictCount).toBe(1);
  expect(catalogConflictReview.governance.excludesRawCatalogContent).toBe(true);
  expect(catalogConflictReview.governance.excludesRawConflictContent).toBe(true);
  expect(catalogConflictReview.items).toBeUndefined();
  expect(JSON.stringify(catalogConflictReview)).not.toContain("Linha remota divergente para conflito visual.");
  const catalogConflictReviewFileChooserPromise = page.waitForEvent("filechooser");
  await catalogPanel.getByRole("button", { name: /^Comparar revisão$/ }).click();
  const catalogConflictReviewFileChooser = await catalogConflictReviewFileChooserPromise;
  const catalogConflictReviewDiffDownloadPromise = page.waitForEvent("download");
  await catalogConflictReviewFileChooser.setFiles(catalogConflictReviewPath);
  const catalogConflictReviewDiffDownload = await catalogConflictReviewDiffDownloadPromise;
  expect(catalogConflictReviewDiffDownload.suggestedFilename()).toMatch(
    /^catalog-conflicts-diff-[a-f0-9]+\.afcatalog-conflicts-diff\.json$/,
  );
  const catalogConflictReviewDiffPath = await catalogConflictReviewDiffDownload.path();
  expect(catalogConflictReviewDiffPath).toBeTruthy();
  const catalogConflictReviewDiff = JSON.parse(await fs.readFile(catalogConflictReviewDiffPath, "utf-8"));
  expect(catalogConflictReviewDiff.format).toBe("agent-flow-builder.catalog-conflict-review-diff.v1");
  expect(catalogConflictReviewDiff.governance.excludesRawCatalogContent).toBe(true);
  expect(catalogConflictReviewDiff.sections.some((section) => section.id === "conflicts")).toBe(true);
  expect(JSON.stringify(catalogConflictReviewDiff)).not.toContain("Linha remota divergente para conflito visual.");
  await catalogPanel.getByLabel("Nome do curador local do catálogo").fill("catalog-curator-ui");
  await catalogPanel.getByLabel("Papel do curador local do catálogo").selectOption("viewer");
  await expect(catalogPanel).toContainText("Atual mais recente");
  await expect(catalogPanel.getByRole("button", { name: /^Manter biblioteca$/ })).toBeDisabled();
  await catalogPanel.getByLabel("Papel do curador local do catálogo").selectOption("reviewer");
  await catalogPanel.getByRole("button", { name: /^Manter biblioteca$/ }).click();
  await expect(catalogPanel).toContainText("Compartilhado: biblioteca revisada");
  await expect(catalogPanel.locator(".catalog-shared-conflicts")).toHaveCount(0);
  const resolvedSharedCatalogResponse = await request.get(`${apiUrl}/catalog/shared-library`);
  await expectApiOk(resolvedSharedCatalogResponse, "load shared catalog after curator conflict resolution");
  const resolvedSharedCatalog = await resolvedSharedCatalogResponse.json();
  expect(resolvedSharedCatalog.openConflictCount).toBe(0);
  expect(resolvedSharedCatalog.conflicts[0].resolvedBy).toBe("catalog-curator-ui");
  expect(resolvedSharedCatalog.conflicts[0].resolution).toBe("keep_library");
  await expect(page.getByText("HTTP JSON tool")).toBeVisible();
  const httpJsonToolCard = page.locator(".catalog-card", { hasText: "HTTP JSON tool" });
  await expect(httpJsonToolCard).toContainText("v1.0.0");
  await expect(httpJsonToolCard).toContainText("rev. 1");
  const httpJsonGovernance = httpJsonToolCard.getByRole("region", {
    name: /Governança do item do catálogo HTTP JSON tool/,
  });
  await expect(httpJsonGovernance).toContainText("Governança");
  await expect(httpJsonGovernance).toContainText("Versionamento");
  await expect(httpJsonGovernance).toContainText("Portabilidade");
  const catalogGovernanceDownloadPromise = page.waitForEvent("download");
  await httpJsonGovernance.getByRole("button", { name: /^Exportar governança do item$/ }).click();
  const catalogGovernanceDownload = await catalogGovernanceDownloadPromise;
  expect(catalogGovernanceDownload.suggestedFilename()).toMatch(/catalog-governance-tool-.*\.afcataloggovernance\.json$/);
  const catalogGovernanceExportPath = await catalogGovernanceDownload.path();
  expect(catalogGovernanceExportPath).toBeTruthy();
  const catalogGovernanceExport = JSON.parse(await fs.readFile(catalogGovernanceExportPath, "utf-8"));
  expect(catalogGovernanceExport.format).toBe("agent-flow-builder.catalog-governance.v1");
  expect(catalogGovernanceExport.item.name).toBe("HTTP JSON tool");
  expect(catalogGovernanceExport.summary.portablePackageReady).toBe(true);
  expect(catalogGovernanceExport.governance.excludesRawCatalogContent).toBe(true);
  expect(catalogGovernanceExport.governance.excludesSecretValues).toBe(true);
  expect(catalogGovernanceExport.item.content).toBeUndefined();
  expect(catalogGovernanceExport.item.nodePatch).toBeUndefined();
  await expect(page.getByText("Prompt de perguntas guiadas")).toBeVisible();
  await expect(page.getByText("Agente gerador de perguntas por conteúdo")).toBeVisible();
  await expect(page.getByText("Skill de perguntas estruturadas")).toBeVisible();
  await expect(page.locator(".catalog-card", { hasText: "Agente gerador de perguntas por conteúdo" })).toContainText("Template visual");
  const revisionCard = page.locator(".catalog-card", { hasText: "Prompt com histórico UI" });
  await expect(revisionCard).toContainText("v1.1.0");
  await expect(revisionCard).toContainText("rev. 2");
  await expect(revisionCard).toContainText("Histórico 1: rev. 1 para 2");
  await revisionCard.locator("summary").click();
  await expect(revisionCard.locator(".catalog-diff-row.removed")).toContainText("Linha inicial para histórico.");
  await expect(revisionCard.locator(".catalog-diff-row.added")).toContainText("Linha revisada para histórico.");
  await revisionCard.getByRole("button", { name: /^Restaurar$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("restaurado para rev. 1", { timeout: 10_000 });
  await expect(revisionCard).toContainText("v1.0.0");
  await expect(revisionCard).toContainText("rev. 3");
  await expect(revisionCard).toContainText("Histórico 2: rev. 2 para 3");
  await expect(revisionCard.locator(".catalog-diff-row.removed")).toContainText("Linha revisada para histórico.");
  await expect(revisionCard.locator(".catalog-diff-row.added")).toContainText("Linha inicial para histórico.");
  await revisionCard.locator(".catalog-history-item", { hasText: "rev. 1" }).getByRole("button", { name: /^Comparar$/ }).click();
  await expect(revisionCard).toContainText("Histórico 2: rev. 1 para 3");
  await expect(revisionCard.locator(".catalog-diff-empty")).toContainText("Sem mudanças de conteúdo");
  await catalogPanel.getByLabel("Buscar no catálogo").fill("HTTP");
  await expect(page.locator(".catalog-card", { hasText: "HTTP JSON tool" })).toBeVisible();
  await expect(page.locator(".catalog-card", { hasText: "Agente gerador de perguntas por conteúdo" })).toHaveCount(0);
  await catalogPanel.getByRole("button", { name: /^Limpar$/ }).click();

  await page.getByRole("button", { name: /^Salvar tool atual$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Tool do nó deterministic_gate salva no catálogo local", {
    timeout: 10_000,
  });
  await expect(page.locator(".catalog-card", { hasText: "deterministic_gate (code)" })).toBeVisible();
  await expect(page.locator(".catalog-card", { hasText: "deterministic_gate (code)" })).toContainText("rev. 1");

  await page.locator(".canvas-node-chip", { hasText: "output_safety_check" }).click();
  await expect(page.locator(".react-flow__node.selected")).toContainText("output_safety_check");
  await page.locator(".canvas-node-chip", { hasText: "deterministic_gate" }).click();
  await expect(page.locator(".react-flow__node.selected")).toContainText("deterministic_gate");
  await page.keyboard.down("Shift");
  await page.locator(".canvas-node-chip", { hasText: "output_safety_check" }).click();
  await page.keyboard.up("Shift");
  await expect(page.getByLabel("Ações da seleção do canvas")).toContainText("2 nós selecionados");
  await openInspectorTab(page, "Catálogo");
  await page.getByRole("button", { name: /^Salvar bloco tool$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Bloco salvo como tool composta", { timeout: 10_000 });
  const savedToolBlock = page.locator(".catalog-card", { hasText: "output_safety_check block" });
  await expect(savedToolBlock).toBeVisible();
  await expect(savedToolBlock).toContainText("Tool composta: 2 nós, 1 aresta(s)");
  await savedToolBlock.locator(".catalog-block-preview summary").click();
  await expect(savedToolBlock.locator(".catalog-block-node-list")).toContainText("output_safety_check");
  await expect(savedToolBlock.locator(".catalog-block-node-list")).toContainText("deterministic_gate");
  await expect(savedToolBlock.locator(".catalog-block-edge-list")).toContainText("output_safety_check -> deterministic_gate");
  await savedToolBlock.getByRole("button", { name: /^Editar item$/ }).click();
  await savedToolBlock.getByLabel("Nome do item").fill("Bloco Safety curado");
  await savedToolBlock.getByLabel("Descrição do item").fill("Bloco revisado visualmente pelo catálogo.");
  await savedToolBlock.getByLabel("Tags do item").fill("tool, bundle, block, reviewed");
  await savedToolBlock
    .getByLabel("Descrição da etapa output_safety_check")
    .fill("Normaliza safety de saída antes do gate determinístico.");
  await savedToolBlock
    .getByLabel("Condição da conexão output_safety_check para deterministic_gate")
    .fill("safety.decision == 'allow'");
  await expect(savedToolBlock.locator(".catalog-editor-validation")).toContainText("Pronto para salvar");
  await savedToolBlock.getByRole("button", { name: /^Adicionar etapa$/ }).click();
  await savedToolBlock.getByLabel("ID da etapa catalog_step").fill("manual_review_step");
  await savedToolBlock.getByLabel("Descrição da etapa manual_review_step").fill("Etapa manual opcional para revisão de segurança.");
  await savedToolBlock.getByRole("button", { name: /^Subir etapa manual_review_step$/ }).click();
  const edgeComposer = savedToolBlock.locator(".catalog-edit-edge-composer");
  await edgeComposer.locator("[data-catalog-edge-from]").selectOption("deterministic_gate");
  await edgeComposer.locator("[data-catalog-edge-to]").selectOption("manual_review_step");
  await edgeComposer.locator("[data-catalog-edge-condition]").fill("review.required == true");
  await edgeComposer.getByRole("button", { name: /^Adicionar conexão$/ }).click();
  await expect(savedToolBlock.locator(".catalog-editor-validation")).toContainText("Pronto para salvar");
  await savedToolBlock.getByRole("button", { name: /^Salvar curadoria$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Curadoria de Bloco Safety curado salva como rev. 2", {
    timeout: 10_000,
  });
  const curatedToolBlock = page.locator(".catalog-card", { hasText: "Bloco Safety curado" });
  await expect(curatedToolBlock).toContainText("rev. 2");
  await expect(curatedToolBlock).toContainText("reviewed");
  await curatedToolBlock.locator(".catalog-block-preview summary").click();
  await expect(curatedToolBlock).toContainText("Tool composta: 3 nós, 2 aresta(s)");
  await expect(curatedToolBlock.locator(".catalog-block-node-list")).toContainText("Normaliza safety de saída");
  await expect(curatedToolBlock.locator(".catalog-block-node-list")).toContainText("manual_review_step");
  await expect(curatedToolBlock.locator(".catalog-block-edge-list")).toContainText("safety.decision == 'allow'");
  await expect(curatedToolBlock.locator(".catalog-block-edge-list")).toContainText("review.required == true");

  const downloadPromise = page.waitForEvent("download");
  await curatedToolBlock.getByRole("button", { name: /^Exportar$/ }).click();
  const catalogDownload = await downloadPromise;
  expect(catalogDownload.suggestedFilename()).toMatch(/catalog-tool-.*\.afcatalog\.json$/);
  const catalogExportPath = await catalogDownload.path();
  expect(catalogExportPath).toBeTruthy();
  const exportedPackage = JSON.parse(await fs.readFile(catalogExportPath, "utf-8"));
  expect(exportedPackage.format).toBe("agent-flow-builder.catalog-item.v1");
  exportedPackage.item.id = "ui-imported-tool-block";
  exportedPackage.item.name = "Bloco Safety importado";
  exportedPackage.item.tags = ["tool", "bundle", "imported"];
  const importPackagePath = testInfo.outputPath("catalog-package.afcatalog.json");
  await fs.writeFile(importPackagePath, `${JSON.stringify(exportedPackage, null, 2)}\n`);
  await page.locator(".catalog-import-input").setInputFiles(importPackagePath);
  await expect(page.locator("footer[role='status']")).toContainText("Pacote importado como Bloco Safety importado rev. 1", {
    timeout: 10_000,
  });
  const importedToolBlock = page.locator(".catalog-card", { hasText: "Bloco Safety importado" });
  await expect(importedToolBlock).toBeVisible();
  await expect(importedToolBlock).toContainText("imported");

  await page.getByRole("button", { name: /^Salvar bloco skill$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Bloco salvo como skill composta", { timeout: 10_000 });
  const savedSkillBlock = page.locator(".catalog-card", { hasText: "output_safety_check skill block" });
  await expect(savedSkillBlock).toBeVisible();
  await expect(savedSkillBlock).toContainText("Skill composta: 2 nós, 1 aresta(s)");

  await page.getByRole("button", { name: /^Salvar prompt atual$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("salvo no catálogo local", { timeout: 10_000 });
  const savedPromptCard = page.locator(".catalog-card", {
    hasText: /Prompt principal para conduzir|Prompt system de Agente de Referência/,
  });
  await expect(savedPromptCard).toBeVisible();
  await catalogPanel.getByLabel("Filtrar origem do catálogo").selectOption("local");
  await expect(page.locator(".catalog-card", { hasText: "deterministic_gate (code)" })).toBeVisible();
  await expect(savedPromptCard).toBeVisible();
  await expect(page.locator(".catalog-card", { hasText: "HTTP JSON tool" })).toHaveCount(0);
  await catalogPanel.getByRole("button", { name: /^Limpar$/ }).click();

  const guardedBlock = page.locator(".catalog-card", { hasText: "Bloco HTTP JSON validado" });
  await expect(guardedBlock).toBeVisible();
  await guardedBlock.getByRole("button", { name: /^Criar bloco$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Bloco HTTP JSON validado aplicado ao flow", {
    timeout: 10_000,
  });
  await expect(page.locator(".react-flow__node", { hasText: "guarded-http-json-block-prepare_payload" })).toHaveCount(1);
  await expect(page.locator(".react-flow__node", { hasText: "guarded-http-json-block-call_http_json" })).toHaveCount(1);

  await page.locator(".canvas-node-chip", { hasText: "deterministic_gate" }).click();
  await openInspectorTab(page, "Catálogo");
  const httpTool = page.locator(".catalog-card", { hasText: "HTTP JSON tool" });
  await httpTool.getByRole("button", { name: /^Usar no nó$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("HTTP JSON tool aplicado ao flow", { timeout: 10_000 });
  await expect(page.locator(".tabs button", { hasText: "Editar" })).toHaveClass(/active/);
  await expect(page.getByLabel("Modo de execução")).toHaveValue("http");
  await expect(page.getByLabel("URL do executor")).toHaveValue("http://127.0.0.1:9001/run");

  await page.locator(".canvas-node-chip", { hasText: "llm_step" }).click();
  await openInspectorTab(page, "Catálogo");
  const questionSkill = page.locator(".catalog-card", { hasText: "Skill de perguntas estruturadas" });
  await questionSkill.getByRole("button", { name: /^Usar no nó$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Skill de perguntas estruturadas aplicado ao flow", {
    timeout: 10_000,
  });
  await expect(page.locator(".tabs button", { hasText: "Editar" })).toHaveClass(/active/);
  const inspector = page.locator(".inspector-body");
  await expect(labeledSelect(inspector, "Tipo")).toHaveValue("llm_structured");
  await expect(labeledSelect(inspector, "Prompt")).toHaveValue("question_generation");
  await expect(labeledSelect(inspector, "Schema")).toHaveValue("question_list");

  await openInspectorTab(page, "Catálogo");
  await page.getByRole("button", { name: /^Salvar skill atual$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Skill do nó llm_step salva no catálogo local", {
    timeout: 10_000,
  });
  const savedLlmSkill = page.locator(".catalog-card", { hasText: "llm_step skill" });
  await expect(savedLlmSkill).toBeVisible();
  await savedLlmSkill.getByRole("button", { name: /^Editar item$/ }).click();
  await savedLlmSkill.getByLabel("ID do prompt question_generation").fill("curated_question_prompt");
  await savedLlmSkill.getByLabel("Path do prompt curated_question_prompt").fill("prompts/curated_question_prompt.md");
  await savedLlmSkill
    .getByLabel("Conteúdo do prompt curated_question_prompt")
    .fill("Você gera perguntas revisadas com base no conteúdo aprovado.\n");
  await savedLlmSkill
    .getByLabel("Conteúdo do schema question_list")
    .fill(JSON.stringify({ type: "object", required: ["questions", "confidence"], properties: { questions: { type: "array", items: { type: "string" } }, confidence: { type: "number" } } }, null, 2));
  const guidedInternalSchemaEditor = savedLlmSkill.getByLabel("Editor guiado do schema question_list");
  await expect(guidedInternalSchemaEditor).toContainText("Schema guiado");
  await expect(guidedInternalSchemaEditor).toContainText("2 campos");
  await guidedInternalSchemaEditor.getByRole("button", { name: /^Campo$/ }).click();
  await guidedInternalSchemaEditor.getByRole("button", { name: /^\$defs$/ }).click();
  await guidedInternalSchemaEditor.getByRole("button", { name: /^oneOf$/ }).click();
  await guidedInternalSchemaEditor.getByRole("button", { name: /^Bloquear extras$/ }).click();
  await expect(guidedInternalSchemaEditor).toContainText("$defs");
  await expect(guidedInternalSchemaEditor).toContainText("extras bloqueados");
  await savedLlmSkill.getByRole("button", { name: /^Adicionar prompt$/ }).click();
  await savedLlmSkill.getByLabel("ID do prompt catalog_prompt").fill("followup_prompt");
  await savedLlmSkill.getByLabel("Path do prompt followup_prompt").fill("prompts/followup_prompt.md");
  await savedLlmSkill.getByLabel("Conteúdo do prompt followup_prompt").fill("Prompt auxiliar para continuidade da conversa.\n");
  await expect(savedLlmSkill.locator(".catalog-editor-validation")).toContainText("Pronto para salvar");
  await savedLlmSkill.getByRole("button", { name: /^Salvar curadoria$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Curadoria de llm_step skill salva como rev. 2", {
    timeout: 10_000,
  });
  await expect(savedLlmSkill).toContainText("rev. 2");
  await savedLlmSkill.locator(".catalog-block-preview summary").click();
  await expect(savedLlmSkill).toContainText("2 prompt(s)");
  await expect(savedLlmSkill.locator(".catalog-block-json")).toContainText("curated_question_prompt");
  const catalogAfterSkillEdit = await request.get(`${apiUrl}/catalog`);
  await expectApiOk(catalogAfterSkillEdit, "load catalog after internal skill asset edit");
  const editedLlmSkill = (await catalogAfterSkillEdit.json()).items.find((item) => item.name === "llm_step skill");
  const editedInternalSchemaContent = JSON.parse(editedLlmSkill.content).schemas[0].content;
  expect(editedInternalSchemaContent).toContain("confidence");
  expect(editedInternalSchemaContent).toContain("SharedObject");
  expect(editedInternalSchemaContent).toContain("oneOf");
  expect(editedInternalSchemaContent).toContain("additionalProperties");
  await savedLlmSkill.getByRole("button", { name: /^Usar no nó$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("llm_step skill aplicado ao flow", {
    timeout: 10_000,
  });
  await expect(labeledSelect(page.locator(".inspector-body"), "Prompt")).toHaveValue("curated_question_prompt");

  await openInspectorTab(page, "Catálogo");
  const contextReviewSkill = page.locator(".catalog-card", { hasText: "Skill composta de revisão com contexto" });
  await expect(contextReviewSkill).toBeVisible();
  await contextReviewSkill.getByRole("button", { name: /^Anexar ao nó$/ }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Skill composta de revisão com contexto aplicado ao flow", {
    timeout: 10_000,
  });
  await expect(page.locator(".react-flow__node", { hasText: "context-review-composite-skill-extract_context" })).toHaveCount(1);
  await expect(page.locator(".react-flow__node", { hasText: "context-review-composite-skill-review_context" })).toHaveCount(1);

  await openInspectorTab(page, "Catálogo");
  const questionAgent = page.locator(".catalog-card", { hasText: "Agente gerador de perguntas por conteúdo" });
  await questionAgent.getByRole("button", { name: /^Criar flow$/ }).click();
  const createFlowDialog = page.getByRole("dialog", { name: "Criar flow" });
  await createFlowDialog.getByLabel("ID do novo flow").fill("catalog-template-ui-agent");
  await createFlowDialog.getByRole("button", { name: "Criar flow" }).click();
  await expect(page.locator("footer[role='status']")).toContainText("Flow catalog-template-ui-agent criado a partir", {
    timeout: 10_000,
  });
  for (const groupName of ["LLM", "RAG"]) {
    const expandGroup = page.getByRole("button", { name: `Expandir grupo ${groupName}` });
    if (await expandGroup.count()) {
      await expandGroup.click();
    }
  }
  await expect(page.locator(".canvas-node-chip", { hasText: "generate_questions" })).toBeVisible();
  await expect(page.locator(".canvas-node-chip", { hasText: "retrieve_context" })).toBeVisible();
  await page.locator("label.flow-select select").selectOption("reference-interview");
  await expect(page.locator(".canvas-node-chip", { hasText: "deterministic_gate" })).toBeVisible();

  await expectNoDocumentHorizontalOverflow(page);
  await expectTopbarControlsToFit(page);
  await expectApiOk(
    await request.put(`${apiUrl}/flows/reference-interview`, { data: originalFlow }),
    "restore original reference flow after catalog test",
  );
  expect(pageErrors, "Unexpected browser errors while using local catalog").toEqual([]);
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
  const compositionAssistant = runtimePanel.getByLabel("Composição assistida multiagente");
  await expect(compositionAssistant).toContainText("Composição assistida");
  await expect(compositionAssistant).toContainText("Agente de triagem");
  await expect(compositionAssistant).toContainText("Agente de suporte");
  await compositionAssistant.getByRole("button", { name: /^Adicionar recomendados$/ }).click();
  await expect(runtimePanel.locator(".manifest-agent-item", { hasText: "triage-agent" })).toBeVisible();
  await expect(runtimePanel.locator(".manifest-agent-item", { hasText: "support-agent" })).toBeVisible();
  const orchestrationPanel = runtimePanel.getByLabel("Orquestração multiagente");
  await expect(orchestrationPanel).toContainText("Orquestração");
  await orchestrationPanel.getByRole("button", { name: /^Sugerir handoffs$/ }).click();
  await expect(orchestrationPanel.getByLabel("Modo")).toHaveValue("router");
  await expect(orchestrationPanel.getByLabel("Agente de entrada")).toHaveValue("triage-agent");
  await expect(orchestrationPanel).toContainText("reference-interview");
  await expect(orchestrationPanel).toContainText("support-agent");
  const memoryPolicyPanel = orchestrationPanel.getByLabel("Política de memória compartilhada");
  await expect(memoryPolicyPanel).toContainText("Memória compartilhada");
  await memoryPolicyPanel.getByLabel("Persistência").selectOption("always_jsonl");
  await memoryPolicyPanel.getByLabel("Persistir por padrão").check();
  await memoryPolicyPanel.getByLabel("Caminho padrão").fill(".runtime-manifest/ui-orchestration-memory.jsonl");
  await memoryPolicyPanel.getByLabel("Máx. entradas").fill("12");
  await memoryPolicyPanel.getByLabel("Retenção runs").fill("3");
  await memoryPolicyPanel.getByLabel("Máx. preview").fill("320");
  await memoryPolicyPanel.getByLabel("Redaction keys").fill("api_key, authorization, token, secret");
  await expect(memoryPolicyPanel.getByLabel("Persistência")).toHaveValue("always_jsonl");
  await expect(memoryPolicyPanel.getByLabel("Máx. entradas")).toHaveValue("12");
  await runtimePanel
    .locator(".manifest-agent-item", { hasText: "triage-agent" })
    .getByRole("button", { name: /^Remover agente$/ })
    .click();
  await runtimePanel
    .locator(".manifest-agent-item", { hasText: "support-agent" })
    .getByRole("button", { name: /^Remover agente$/ })
    .click();
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
  await page.request.post(`${apiUrl}/flows/reference-interview/generate-langgraph-sandbox`, {
    data: { outDir: "generated/reference-interview-langgraph-sandbox" },
  });
  await page.request.post(`${apiUrl}/flows/reference-interview/approve-langgraph-sandbox`, {
    data: { outDir: "generated/reference-interview-langgraph-sandbox" },
  });
  await runtimePanel.getByRole("button", { name: /^Gerar bundle aprovado$/ }).click();
  await expect(page.getByText("API Docker final")).toBeVisible({ timeout: 30_000 });
  const dockerRuntimeSection = page.locator(".sandbox-section", { hasText: "API Docker final" });
  await expect(dockerRuntimeSection.locator("dd", { hasText: /^runtime-manifest-bundle$/ }).first()).toBeVisible();
  await expect(page.locator(".runtime-export-audit")).toContainText("pronto");
  await expect(page.locator(".runtime-export-audit")).toContainText(".agent-flow/export-manifest.json");
  await expect(page.getByLabel("Agente do smoke")).toHaveValue("reference-interview");
  await expect(page.getByLabel("Agente do smoke")).toContainText("/reference-interview/sessions");
  const dockerAgentsSection = page.getByLabel("Agentes operacionais do bundle");
  await expect(dockerAgentsSection).toContainText("reference-interview");
  await expect(dockerAgentsSection).toContainText("pendente");
  await expect(dockerAgentsSection).toContainText("Smoke deste agente ainda não foi executado neste histórico.");
  await expect(dockerAgentsSection).toContainText("Worker jobs");
  await expect(dockerAgentsSection).toContainText("Retry/claim jobs");
  await expect(dockerAgentsSection).toContainText("não verificado");
  await expect(dockerAgentsSection).toContainText("/reference-interview/metadata");
  await expect(dockerAgentsSection).toContainText("/reference-interview/sessions");
  await expect(dockerAgentsSection.getByRole("link", { name: /^Metadata$/ })).toHaveAttribute(
    "href",
    "http://127.0.0.1:8080/reference-interview/metadata",
  );
  await expect(dockerAgentsSection.getByRole("button", { name: /^Smoke agora$/ })).toBeEnabled();
  await expect(dockerAgentsSection.getByRole("button", { name: /^Selecionado$/ })).toBeDisabled();
  await expect(dockerAgentsSection.getByRole("button", { name: /^Runbook$/ })).toBeEnabled();
  const [agentRunbookDownload] = await Promise.all([
    page.waitForEvent("download"),
    dockerAgentsSection.getByRole("button", { name: /^Runbook$/ }).click(),
  ]);
  expect(agentRunbookDownload.suggestedFilename()).toBe(
    "reference-runtime-bundle-reference-interview-agent-runbook.afagentrunbook.json",
  );
  const agentRunbookPath = await agentRunbookDownload.path();
  const agentRunbook = JSON.parse(await fs.readFile(agentRunbookPath, "utf-8"));
  expect(agentRunbook.format).toBe("agent-flow-builder.runtime-agent-runbook.v1");
  expect(agentRunbook.agent.id).toBe("reference-interview");
  expect(agentRunbook.endpoints.metadataUrl).toBe("http://127.0.0.1:8080/reference-interview/metadata");
  expect(agentRunbook.endpoints.sessionsUrl).toBe("http://127.0.0.1:8080/reference-interview/sessions");
  expect(agentRunbook.smoke.status).toBe("pending");
  expect(agentRunbook.smoke.jobsOperations).toBe(null);
  expect(agentRunbook.smoke.jobsOperationsLabels).toEqual({
    worker: "não verificado",
    retryConcurrency: "não verificado",
    retention: "não verificado",
    schedules: "não verificado",
  });
  expect(agentRunbook.governance.includesEnvValues).toBe(false);
  expect(agentRunbook.commands.some((command) => command.id === "turn")).toBe(true);
  await page.route("http://127.0.0.1:8080/orchestration/run", async (route) => {
    await fulfillJson(route, {
      format: "agent-flow-builder.runtime-orchestration-run.v1",
      manifest_id: "reference-runtime",
      manifest_version: "0.1.0",
      mode: "router",
      entry_agent_id: "reference-interview",
      status: "completed",
      steps: [
        {
          agent_id: "reference-interview",
          route_prefix: "/reference-interview",
          resource_name: "sessions",
          session_id: "orch-session-1",
          start: { raw: "raw-orchestration-step-start" },
          turn: { assistant_message: { code: "QUESTION", text: "raw-orchestration-step-turn" } },
        },
        {
          agent_id: "reference-interview",
          route_prefix: "/reference-interview",
          resource_name: "sessions",
          session_id: "orch-session-1",
          handoff_condition: "input contains: suporte",
          turn: { assistant_message: { code: "DONE", text: "raw-orchestration-step-final" } },
        },
      ],
      shared_memory: { raw: "raw-orchestration-shared-memory" },
      debug_trace: {
        format: "agent-flow-builder.runtime-orchestration-debug-trace.v1",
        run_id: "orch-ui-audit-1",
        manifest_id: "reference-runtime",
        manifest_version: "0.1.0",
        mode: "router",
        entry_agent_id: "reference-interview",
        started_at: "2026-07-04T00:00:00.000Z",
        finished_at: "2026-07-04T00:00:01.000Z",
        input: { user_message: "raw-orchestration-input" },
        timeline: [
          { type: "plan_created", status: "planned", agent_id: "reference-interview", output: "raw-orchestration-timeline-plan" },
          { type: "handoff_decision", status: "matched", agent_id: "reference-interview", to_agent_id: "reference-interview", output: "raw-orchestration-timeline-handoff" },
          { type: "orchestration_completed", status: "completed", agent_id: "reference-interview" },
        ],
        summary: {
          status: "completed",
          step_count: 2,
          agent_ids: ["reference-interview"],
          memory_entries: 1,
          handoff_decisions: 1,
          matched_handoffs: 1,
          timeline_events: 3,
        },
        governance: { excludes_secrets: true },
      },
      governance: { excludes_secrets: true },
    });
  });
  const orchestrationDebugPanel = page.getByLabel("Debug da orquestração multiagente");
  await expect(orchestrationDebugPanel).toContainText("execute o bundle para ver a timeline entre agentes");
  await orchestrationDebugPanel.getByRole("button", { name: /^Executar$/ }).click();
  await expect(orchestrationDebugPanel).toContainText("completed · 2 etapa(s) · 3 evento(s)", { timeout: 10_000 });
  const bundleDeliveryChecklist = page.getByLabel("Checklist de entrega final");
  const [bundleReportDownload] = await Promise.all([
    page.waitForEvent("download"),
    bundleDeliveryChecklist.getByRole("button", { name: /^Baixar relatório$/ }).click(),
  ]);
  expect(bundleReportDownload.suggestedFilename()).toMatch(/delivery-report\.json$/);
  const bundleReportPath = await bundleReportDownload.path();
  expect(bundleReportPath).toBeTruthy();
  const bundleDeliveryReport = JSON.parse(await fs.readFile(bundleReportPath, "utf-8"));
  expect(bundleDeliveryReport.format).toBe("agent-flow-builder.runtime-delivery-report.v1");
  expect(bundleDeliveryReport.agentOperations).toHaveLength(1);
  expect(bundleDeliveryReport.agentOperations[0].agentId).toBe("reference-interview");
  expect(bundleDeliveryReport.agentOperations[0].routePrefix).toBe("/reference-interview");
  expect(bundleDeliveryReport.agentOperations[0].jobsOperations).toBe(null);
  expect(bundleDeliveryReport.agentOperations[0].jobsOperationsLabels).toEqual({
    worker: "não verificado",
    retryConcurrency: "não verificado",
    retention: "não verificado",
    schedules: "não verificado",
  });
  expect(bundleDeliveryReport.orchestration).toMatchObject({
    available: true,
    historyCount: 1,
    latestRun: {
      runId: "orch-ui-audit-1",
      status: "completed",
      mode: "router",
      entryAgentId: "reference-interview",
      stepCount: 2,
      timelineEvents: 3,
      handoffDecisions: 1,
      matchedHandoffs: 1,
      memoryEntries: 1,
      errorMessage: null,
    },
    comparison: null,
    governance: {
      source: "local_orchestration_debug_history",
      excludesRawInput: true,
      excludesSharedMemory: true,
      excludesStepPayloads: true,
      excludesRawTimeline: true,
      includesOnlySummary: true,
    },
  });
  const bundleDeliveryReportText = JSON.stringify(bundleDeliveryReport);
  expect(bundleDeliveryReportText).not.toContain("raw-orchestration-input");
  expect(bundleDeliveryReportText).not.toContain("raw-orchestration-shared-memory");
  expect(bundleDeliveryReportText).not.toContain("raw-orchestration-step-turn");
  expect(bundleDeliveryReportText).not.toContain("raw-orchestration-timeline-handoff");
  expect(bundleDeliveryReport.export.includesEnvValues).toBe(false);
  await dockerAgentsSection.getByRole("button", { name: /^Histórico$/ }).click();
  await expect(dockerRuntimeSection.getByLabel("Operação")).toHaveValue("smoke");
  await expect(dockerRuntimeSection.getByLabel("Busca")).toHaveValue("reference-interview");
  const runbookRoutes = page.getByLabel("Rotas do pacote exportado");
  await expect(runbookRoutes).toContainText("reference-interview");
  await expect(runbookRoutes).toContainText("http://127.0.0.1:8080/reference-interview/metadata");
  await expect(runbookRoutes).toContainText("http://127.0.0.1:8080/reference-interview/sessions");

  await expectNoDocumentHorizontalOverflow(page);
  await expectTopbarControlsToFit(page);
  expect(pageErrors, "Unexpected browser errors while saving runtime manifest visually").toEqual([]);
});

for (const theme of themes) {
  test(`studio runs with data render in ${theme} theme`, async ({ page, request }) => {
    const pageErrors = attachBrowserErrorCollector(page);
    const externalEvaluatorRequests = [];
    await seedStudioRuns(request);
    const resetAnnotationQueueResponse = await request.put(`${apiUrl}/flows/reference-interview/annotation-queue`, {
      data: { items: [] },
    });
    await expectApiOk(resetAnnotationQueueResponse, "reset shared annotation queue before studio UI audit");
    const resetNodePinsResponse = await request.put(`${apiUrl}/flows/reference-interview/studio-node-pins`, {
      data: {
        format: "agent-flow-builder.studio-node-pins.v1",
        flowId: "reference-interview",
        pins: [],
      },
    });
    await expectApiOk(resetNodePinsResponse, "reset shared Studio node pins before studio UI audit");
    await page.route(`${apiUrl}/flows/reference-interview/schemas/session_state`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "session_state",
          path: "schemas/session_state.schema.json",
          content: JSON.stringify({
            $schema: "https://json-schema.org/draft/2020-12/schema",
            title: "StudioTurnPayload",
            type: "object",
            required: ["user_message", "extracted_content"],
            properties: {
              session_id: { type: "string" },
              turn: { type: "integer" },
              user_message: {
                type: "string",
                description: "Mensagem principal do usuário.",
              },
              extracted_content: {
                type: "string",
                description: "Conteúdo bruto usado para gerar perguntas.",
              },
              priority: {
                type: "integer",
                description: "Prioridade operacional do teste.",
              },
              include_sources: {
                type: "boolean",
                description: "Inclui fontes recuperadas no payload.",
              },
              context: {
                type: "object",
                required: ["topic"],
                description: "Contexto estruturado do turno.",
                properties: {
                  topic: {
                    type: "string",
                    description: "Assunto principal.",
                  },
                  audience_size: {
                    type: "integer",
                    description: "Tamanho aproximado da audiência.",
                  },
                  reviewed: {
                    type: "boolean",
                    description: "Indica se o contexto foi revisado.",
                  },
                },
              },
              source_urls: {
                type: "array",
                description: "URLs de fonte enviadas junto do turno.",
                items: { type: "string" },
              },
              references: {
                type: "array",
                description: "Referências estruturadas para o turno.",
                items: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string" },
                    score: { type: "number" },
                    approved: { type: "boolean" },
                  },
                },
              },
              recent_messages: { type: "array" },
            },
          }),
        }),
      });
    });
    await page.route(`${apiUrl}/evaluators/external`, async (route) => {
      const payload = route.request().postDataJSON();
      externalEvaluatorRequests.push(payload);
      expect(payload.endpointUrl).toBe("http://127.0.0.1:4567/judge");
      expect(payload.passPath).toBe("result.pass");
      expect(payload.reasonPath).toBe("result.reason");
      expect(payload.scorePath).toBe("result.score");
      expect(payload.verdictPath).toBe("result.verdict");
      expect(payload.payload.evaluator.kind).toBe("llm_judge");
      expect(payload.payload.evaluator.rubric).toContain("pergunta gerada");
      expect(payload.payload.observedOutput).toContain("Pergunta gerada");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          format: "agent-flow-builder.external-evaluator-result.v1",
          ok: true,
          pass: true,
          severity: "pass",
          verdict: "judge-pass",
          reason: "rubrica atendida",
          score: 0.94,
          status: 200,
          elapsedMs: 12,
          raw: {
            result: {
              pass: true,
              score: 0.94,
              reason: "rubrica atendida",
              verdict: "judge-pass",
            },
          },
        }),
      });
    });
    await installStudioRuntimeStreamMocks(page);

    await openBuilder(page, theme, viewports[0]);
    await openInspectorTab(page, "Studio");

    await expect(page.getByText("Runs locais")).toBeVisible();
    const studioGlobalStatus = page.getByLabel("Status global do Studio");
    await expect(studioGlobalStatus).toContainText("Sem sessão ativa");
    await expect(studioGlobalStatus).toContainText("run(s)");
    await expect(studioGlobalStatus.getByRole("button", { name: /^Iniciar Studio$/ })).toBeVisible();
    const studioApprovalGate = page.getByLabel("Gate de aprovação do Studio");
    await expect(studioApprovalGate).toContainText("Gate de aprovação");
    await expect(studioApprovalGate).toContainText("Aprovação:");
    await expect(studioApprovalGate).toContainText("versão");
    await expect(studioApprovalGate).toContainText("hash");
    await expect(studioApprovalGate).toContainText("cobertura");
    await expect(studioApprovalGate).toContainText("artefato");
    await expect(studioApprovalGate).toContainText("evidência");
    await expect(studioApprovalGate).toContainText("handoff");
    await expect(studioApprovalGate).toContainText(/Runtime final liberado|API Docker bloqueada/);
    await expect(studioApprovalGate.getByRole("button", { name: /^Preparar sandbox$/ })).toBeVisible();
    await expect(studioApprovalGate.getByRole("button", { name: /^Registrar aprovação$/ })).toBeVisible();
    await expect(studioApprovalGate.getByRole("button", { name: /^Handoff cloud$/ })).toBeVisible();
    await expect(studioApprovalGate.getByRole("button", { name: /^Gerar runtime final$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /ui-audit-error/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /ui-audit-ok/ })).toBeVisible();
    const providerTelemetrySection = page.getByLabel("Telemetria histórica por provider");
    await expect(providerTelemetrySection).toContainText("Telemetria histórica");
    await expect(providerTelemetrySection).toContainText("runs com usage");
    await expect(providerTelemetrySection).toContainText("eventos medidos");
    await expect(providerTelemetrySection).toContainText("openai");
    await expect(providerTelemetrySection).toContainText("gpt-4.1-mini");
    await expect(providerTelemetrySection).toContainText("168");
    await expect(providerTelemetrySection).toContainText("$0.0024");
    await expect(providerTelemetrySection).toContainText("run-ui-audit-ok");
    await providerTelemetrySection.getByLabel("Janela da telemetria de provider").selectOption("24");
    await providerTelemetrySection.getByLabel("Limite tokens por provider").fill("100");
    await providerTelemetrySection.getByLabel("Limite custo por provider").fill("0.001");
    await providerTelemetrySection.getByRole("button", { name: /^Atualizar telemetria$/ }).click();
    await providerTelemetrySection.getByRole("button", { name: /^Salvar snapshot$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Snapshot de telemetria de provider salvo", { timeout: 10_000 });
    await expect(providerTelemetrySection.getByLabel("Dashboard histórico de telemetria por provider")).toContainText(
      "Dashboard histórico de providers",
    );
    const providerTelemetryHistoryDownloadPromise = page.waitForEvent("download");
    await providerTelemetrySection.getByRole("button", { name: /^Exportar histórico$/ }).click();
    const providerTelemetryHistoryDownload = await providerTelemetryHistoryDownloadPromise;
    expect(providerTelemetryHistoryDownload.suggestedFilename()).toBe(
      "provider-telemetry-dashboard-history-reference-interview.afprovidertelemetryhistory.json",
    );
    const providerTelemetryHistoryPath = await providerTelemetryHistoryDownload.path();
    expect(providerTelemetryHistoryPath).toBeTruthy();
    const providerTelemetryHistoryFile = JSON.parse(await fs.readFile(providerTelemetryHistoryPath, "utf-8"));
    expect(providerTelemetryHistoryFile.format).toBe("agent-flow-builder.provider-telemetry-dashboard-history.v1");
    expect(providerTelemetryHistoryFile.snapshotCount).toBeGreaterThanOrEqual(1);
    expect(providerTelemetryHistoryFile.governance.includesRawRunEvents).toBe(false);
    expect(providerTelemetryHistoryFile.governance.includesSinkTokens).toBe(false);
    expect(JSON.stringify(providerTelemetryHistoryFile)).not.toContain("SHOULD_NOT_PERSIST");
    const providerTelemetryHistoryDiffDownloadPromise = page.waitForEvent("download");
    await page
      .getByLabel("Comparar histórico governado de telemetria por provider")
      .setInputFiles(providerTelemetryHistoryPath);
    const providerTelemetryHistoryDiffDownload = await providerTelemetryHistoryDiffDownloadPromise;
    expect(providerTelemetryHistoryDiffDownload.suggestedFilename()).toMatch(
      /^provider-telemetry-dashboard-history-diff-reference-interview-.*\.afprovidertelemetryhistory-diff\.json$/,
    );
    const providerTelemetryHistoryDiffPath = await providerTelemetryHistoryDiffDownload.path();
    expect(providerTelemetryHistoryDiffPath).toBeTruthy();
    const providerTelemetryHistoryDiffFile = JSON.parse(await fs.readFile(providerTelemetryHistoryDiffPath, "utf-8"));
    expect(providerTelemetryHistoryDiffFile.format).toBe("agent-flow-builder.provider-telemetry-dashboard-history-diff.v1");
    expect(providerTelemetryHistoryDiffFile.summary.unchangedCount).toBeGreaterThanOrEqual(1);
    expect(providerTelemetryHistoryDiffFile.governance.excludesTelemetryPayload).toBe(true);
    expect(JSON.stringify(providerTelemetryHistoryDiffFile)).not.toContain('"telemetry"');
    expect(JSON.stringify(providerTelemetryHistoryDiffFile)).not.toContain('"alerts"');
    await expect(providerTelemetrySection.getByLabel("Alertas de telemetria", { exact: true })).toContainText("Alertas");
    await expect(providerTelemetrySection).toContainText("openai/gpt-4.1-mini passou do limite de tokens por provider.");
    await expect(providerTelemetrySection).toContainText("openai/gpt-4.1-mini passou do limite de custo por provider.");
    await expect(providerTelemetrySection).toContainText("orçamento: tokens");
    await expect(providerTelemetrySection).toContainText("alerta");
    await providerTelemetrySection.getByLabel("Retenção de alertas de telemetria").selectOption("7");
    await providerTelemetrySection.getByRole("button", { name: /^Registrar alertas$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("alerta(s) de telemetria registrado(s).");
    const alertInbox = providerTelemetrySection.getByLabel("Inbox de alertas de telemetria", { exact: true });
    await expect(alertInbox).toContainText("tokens");
    const storedTelemetryAlerts = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("agent-flow-builder.provider-telemetry-alerts.reference-interview") || "null"),
    );
    expect(storedTelemetryAlerts.format).toBe("agent-flow-builder.provider-telemetry-alerts.v1");
    expect(storedTelemetryAlerts.alertCount).toBeGreaterThanOrEqual(2);
    expect(storedTelemetryAlerts.openCount).toBe(storedTelemetryAlerts.alertCount);
    await expect(alertInbox).toContainText(`${storedTelemetryAlerts.openCount} aberto(s)`);
    await expect(alertInbox).toContainText(`${storedTelemetryAlerts.alertCount} retido(s)`);
    expect(storedTelemetryAlerts.items[0].route).toBe("local-inbox");
    expect(storedTelemetryAlerts.retentionPolicy.excludesRawRunEvents).toBe(true);
    expect(storedTelemetryAlerts.retentionPolicy.excludesSecretValues).toBe(true);
    expect(storedTelemetryAlerts.items[0].raw).toBeUndefined();
    await expect
      .poll(async () => {
        const response = await page.request.get(`${apiUrl}/flows/reference-interview/provider-telemetry-alerts`);
        const payload = await response.json();
        return `${payload.openCount}:${payload.alertCount}:${payload.retentionPolicy?.excludesRawRunEvents === true}`;
      })
      .toBe(`${storedTelemetryAlerts.openCount}:${storedTelemetryAlerts.alertCount}:true`);
    const telemetryAlertsDownloadPromise = page.waitForEvent("download");
    await providerTelemetrySection.getByRole("button", { name: /^Exportar alertas$/ }).click();
    const telemetryAlertsDownload = await telemetryAlertsDownloadPromise;
    expect(telemetryAlertsDownload.suggestedFilename()).toBe(
      "studio-provider-telemetry-alerts-reference-interview.aftelemetryalerts.json",
    );
    const telemetryAlertsDownloadPath = await telemetryAlertsDownload.path();
    expect(telemetryAlertsDownloadPath).toBeTruthy();
    const telemetryAlertsFile = JSON.parse(await fs.readFile(telemetryAlertsDownloadPath, "utf-8"));
    expect(telemetryAlertsFile.format).toBe("agent-flow-builder.provider-telemetry-alerts.v1");
    expect(telemetryAlertsFile.alertCount).toBe(storedTelemetryAlerts.alertCount);
    await providerTelemetrySection.getByRole("button", { name: /^Reconhecer abertos$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText(`${storedTelemetryAlerts.openCount} alerta(s) reconhecido(s).`);
    await expect(alertInbox).toContainText("0 aberto(s)");
    await expect
      .poll(async () => {
        const response = await page.request.get(`${apiUrl}/flows/reference-interview/provider-telemetry-alerts`);
        const payload = await response.json();
        return `${payload.openCount}:${payload.alertCount}`;
      })
      .toBe(`0:${storedTelemetryAlerts.alertCount}`);
    await expect(page.getByText("Agentes", { exact: true })).toBeVisible();
    await expect(page.locator(".studio-agent-list").getByRole("button", { name: /support-agent/ })).toBeVisible();
    const secretsSection = page.getByLabel("Secrets locais");
    await expect(secretsSection.getByText("OPENAI_API_KEY")).toBeVisible();
    await expect(secretsSection.getByText("OPENAI_BASE_URL")).toBeVisible();
    await expect(secretsSection.getByText("MOCK_LLM")).toBeVisible();
    const apiKeySecret = secretsSection.getByLabel("Secret local OPENAI_API_KEY");
    await expect(apiKeySecret).toHaveAttribute("type", "password");
    await apiKeySecret.fill("ui-test-key");
    await secretsSection.getByTitle("Revelar OPENAI_API_KEY").click();
    await expect(apiKeySecret).toHaveAttribute("type", "text");
    await secretsSection.getByTitle("Ocultar OPENAI_API_KEY").click();
    await expect(apiKeySecret).toHaveAttribute("type", "password");
    await secretsSection.getByLabel("Novo secret local").fill("LOCAL_TEST_TOKEN");
    await secretsSection.getByRole("button", { name: /^Adicionar$/ }).click();
    await expect(secretsSection.getByText("LOCAL_TEST_TOKEN")).toBeVisible();
    await secretsSection.getByLabel("Secret local LOCAL_TEST_TOKEN").fill("token-local");
    const policySection = page.getByLabel("Política de runtime para secrets");
    await expect(policySection.getByText("Política de runtime para secrets")).toBeVisible();
    await policySection.getByLabel("Nome do perfil").fill("UI Audit Policy");
    await policySection.getByLabel("Descrição").fill("Perfil compartilhável criado pela auditoria visual.");
    await policySection.getByLabel("Variáveis obrigatórias (por vírgula)").fill("OPENAI_API_KEY, LOCAL_TEST_TOKEN, TEAM_SHARED_TOKEN");
    await policySection.getByLabel("Variáveis protegidas (não exportáveis)").fill("LOCAL_TEST_TOKEN");
    await policySection.getByRole("button", { name: /^Salvar perfil$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Política "UI Audit Policy" salva');
    await expect(policySection.getByLabel("Perfil aplicado")).toHaveValue(/secret-policy-/);
    await policySection.getByRole("button", { name: /^Definir padrão$/ }).click();
    await expect(policySection.getByLabel("Padrão da workspace")).toHaveValue("UI Audit Policy");
    const policyDownloadPromise = page.waitForEvent("download");
    await policySection.getByRole("button", { name: /^Exportar perfis$/ }).click();
    const policyDownload = await policyDownloadPromise;
    expect(policyDownload.suggestedFilename()).toBe("studio-secret-policy-profiles.afsecrets.json");
    const policyDownloadPath = await policyDownload.path();
    expect(policyDownloadPath).toBeTruthy();
    const policyFile = JSON.parse(await fs.readFile(policyDownloadPath, "utf-8"));
    expect(policyFile.format).toBe("agent-flow-builder.secret-policy-profiles.v1");
    expect(policyFile.profiles[0].name).toBe("UI Audit Policy");
    expect(policyFile.profiles[0].requiredEnvNames).toEqual(expect.arrayContaining(["LOCAL_TEST_TOKEN", "TEAM_SHARED_TOKEN"]));
    expect(policyFile.profiles[0].protectedEnvNames).toEqual(["LOCAL_TEST_TOKEN"]);
    const envDownloadPromise = page.waitForEvent("download");
    await secretsSection.getByRole("button", { name: /^Exportar \.env$/ }).click();
    const envDownload = await envDownloadPromise;
    expect(envDownload.suggestedFilename()).toBe("reference-interview.local.env");
    const envDownloadPath = await envDownload.path();
    expect(envDownloadPath).toBeTruthy();
    const envFile = await fs.readFile(envDownloadPath, "utf-8");
    expect(envFile).toContain("OPENAI_API_KEY=ui-test-key");
    expect(envFile).toContain("Protegidas não exportadas: LOCAL_TEST_TOKEN");
    expect(envFile).not.toContain("LOCAL_TEST_TOKEN=token-local");
    expect(envFile).not.toContain("OPENAI_BASE_URL=");
    expect(envFile).not.toContain("DATABASE_URL=");
    const governanceSection = page.getByLabel("Governança runtime/secrets");
    await expect(governanceSection.getByText("Governança runtime/secrets")).toBeVisible();
    await expect(governanceSection).toContainText("2/5");
    await expect(governanceSection).toContainText("2");
    await expect(governanceSection).toContainText("Pendentes:");
    await expect(governanceSection).toContainText("OPENAI_BASE_URL");
    await expect(governanceSection).toContainText("MOCK_LLM");
    await expect(governanceSection).toContainText("TEAM_SHARED_TOKEN");
    await expect(governanceSection).toContainText("LOCAL_TEST_TOKEN");
    await expect(governanceSection).toContainText("Protegido por política");
    await expect(governanceSection).toContainText("será enviada");
    await expect(governanceSection).toContainText("Runtime local sobrescreve este valor");
    await expect(governanceSection).toContainText("Fixas do sandbox");
    await secretsSection.getByLabel("Novo secret local").fill("STUDIO_RUNTIME_API_KEY");
    await secretsSection.getByRole("button", { name: /^Adicionar$/ }).click();
    await expect(secretsSection.getByText("STUDIO_RUNTIME_API_KEY")).toBeVisible();
    await secretsSection.getByLabel("Secret local STUDIO_RUNTIME_API_KEY").fill("ui-runtime-audit-key");
    await policySection.getByRole("button", { name: /^Remover perfil$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Política removida");
    await page.getByLabel("Importar biblioteca de perfis de secret").setInputFiles({
      name: "studio-secret-policy-profiles.afsecrets.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(policyFile), "utf-8"),
    });
    await expect(page.locator("footer[role='status']")).toContainText("Biblioteca de perfis importada");
    await expect(policySection.getByLabel("Perfil aplicado")).toContainText("UI Audit Policy");
    const guidedTurnInput = page.getByLabel("Entrada guiada por schema");
    await expect(guidedTurnInput).toContainText("Payload do turno");
    await expect(guidedTurnInput).toContainText("user_message");
    await expect(guidedTurnInput).toContainText("string · schema");
    await expect(guidedTurnInput).toContainText("extracted_content");
    await expect(guidedTurnInput).toContainText("integer · schema");
    await expect(guidedTurnInput).toContainText("context");
    await expect(guidedTurnInput).toContainText("context.topic");
    const sourceUrlsArray = guidedTurnInput.getByLabel("Array source_urls");
    await expect(sourceUrlsArray).toContainText("0 item(ns)");
    await sourceUrlsArray.getByRole("button", { name: /Adicionar item/ }).click();
    await page.getByLabel("Campo source_urls[0]").fill("https://example.com/origem");
    const referencesArray = guidedTurnInput.getByLabel("Array references");
    await referencesArray.getByRole("button", { name: /Adicionar item/ }).click();
    await page.getByLabel("Campo references[0].title").fill("Briefing aprovado");
    await page.getByLabel("Campo references[0].score").fill("0.91");
    await page.getByLabel("Campo references[0].approved").selectOption("true");
    await page.getByLabel("Mensagem do usuário").fill("Mensagem guiada pelo schema.");
    await page.getByLabel("Campo extracted_content").fill("Conteúdo carregado para perguntas.");
    await page.getByLabel("Campo priority").fill("3");
    await page.getByLabel("Campo include_sources").selectOption("true");
    await page.getByLabel("Campo context.topic").fill("Onboarding B2B");
    await page.getByLabel("Campo context.audience_size").fill("120");
    await page.getByLabel("Campo context.reviewed").selectOption("true");
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText("Mensagem guiada pelo schema.");
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText("Conteúdo carregado para perguntas.");
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"priority": 3');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"include_sources": true');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"context": {');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"topic": "Onboarding B2B"');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"audience_size": 120');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"reviewed": true');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"source_urls": [');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"https://example.com/origem"');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"references": [');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"title": "Briefing aprovado"');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"score": 0.91');
    await expect(guidedTurnInput.locator(".guided-turn-payload")).toContainText('"approved": true');
    const liveEventsSection = page.getByLabel("Eventos ao vivo");
    await expect(liveEventsSection).toContainText("Eventos ao vivo");
    await expect(liveEventsSection).toContainText("desconectado");
    await expect(liveEventsSection).toContainText("transporte WebSocket");
    await expect(liveEventsSection).toContainText("recebidos 0");
    await expect(liveEventsSection.getByLabel("Transporte de eventos")).toHaveValue("websocket");
    await expect(liveEventsSection.getByLabel("Transporte de eventos")).toContainText("SSE");
    await expect(liveEventsSection.getByRole("button", { name: /Conectar/ })).toBeVisible();
    await expect(liveEventsSection.getByRole("button", { name: /Desconectar/ })).toBeDisabled();
    const liveExecutionSection = page.getByLabel("Execução ao vivo");
    await expect(liveExecutionSection).toContainText("Execução ao vivo");
    await expect(liveExecutionSection).toContainText("nós concluídos");
    await expect(liveExecutionSection).toContainText("Progresso por nó");
    await expect(liveExecutionSection).toContainText("llm_step");
    await expect(liveExecutionSection).toContainText("Spans");
    await expect(liveExecutionSection).toContainText("sem usage/custo ainda");
    await expect(page.getByLabel("Transporte do stream do turno")).toHaveValue("sse");
    await expect(page.getByLabel("Transporte do stream do turno")).toContainText("WebSocket");
    const runtimeJobsSection = page.getByLabel("Jobs pós-finalização");
    await expect(runtimeJobsSection.getByText("Jobs pós-finalização", { exact: true })).toBeVisible();
    await expect(runtimeJobsSection).toContainText("pendentes agora");
    await expect(runtimeJobsSection).toContainText("sucesso");
    await expect(runtimeJobsSection).toContainText("duração média");
    await expect(runtimeJobsSection).toContainText("p95 janela");
    await expect(runtimeJobsSection).toContainText("throughput");
    await expect(runtimeJobsSection).toContainText("Worker: não verificado");
    await expect(runtimeJobsSection).toContainText("Retry/concorrência: não verificado");
    await expect(runtimeJobsSection).toContainText("Retenção: não verificado");
    await expect(runtimeJobsSection).toContainText("Schedules: não verificado");
    await expect(runtimeJobsSection).toContainText("Janela:");
    await expect(runtimeJobsSection).toContainText("Agendamento:");
    await expect(runtimeJobsSection).toContainText("última hora");
    await expect(runtimeJobsSection).toContainText("Duração:");
    await expect(runtimeJobsSection).toContainText("Agendas recorrentes");
    await expect(runtimeJobsSection).toContainText("Nenhum job encontrado");
    await expect(runtimeJobsSection).toContainText("Nenhuma agenda recorrente");
    await expect(runtimeJobsSection.getByLabel("Janela de métricas de jobs")).toHaveValue("1");
    await expect(runtimeJobsSection.getByLabel("Janela de métricas de jobs")).toContainText("7d");
    await expect(runtimeJobsSection.getByLabel("Escopo")).toHaveValue("session");
    await expect(runtimeJobsSection.getByLabel("Status")).toHaveValue("");
    await expect(runtimeJobsSection.getByRole("button", { name: /Atualizar jobs/ })).toBeDisabled();
    await expect(runtimeJobsSection.getByRole("button", { name: /Salvar snapshot/ })).toBeDisabled();
    const initialRuntimeJobHistoryExportButton = runtimeJobsSection.getByRole("button", { name: /Exportar histórico/ });
    await expect(initialRuntimeJobHistoryExportButton).toBeVisible();
    await expect(runtimeJobsSection).toContainText("Histórico local");
    if (await initialRuntimeJobHistoryExportButton.isDisabled()) {
      await expect(runtimeJobsSection).toContainText("Nenhum snapshot salvo");
    } else {
      await expect(runtimeJobsSection).toContainText("snapshot(s)");
    }
    await expect(runtimeJobsSection.getByRole("button", { name: /Executar pendentes/ })).toBeDisabled();
    await expect(runtimeJobsSection.getByRole("button", { name: /Reprocessar falhos/ })).toBeDisabled();
    await expect(runtimeJobsSection.getByRole("button", { name: /Prévia limpeza/ })).toBeDisabled();
    await expect(runtimeJobsSection.getByRole("button", { name: /Limpar 7d/ })).toBeDisabled();
    await expect(runtimeJobsSection.getByRole("button", { name: /Enfileirar vencidas/ })).toBeDisabled();
    await expect(runtimeJobsSection.getByRole("button", { name: /Disparar fim/ })).toBeDisabled();
    const runtimeAuthKeysSection = page.getByLabel("Chaves de autenticação do runtime");
    await expect(runtimeAuthKeysSection.getByText("Chaves de auth", { exact: true })).toBeVisible();
    await expect(runtimeAuthKeysSection).toContainText("Nenhuma chave carregada");
    await expect(runtimeAuthKeysSection.getByRole("button", { name: /Atualizar chaves/ })).toBeDisabled();
    await expect(runtimeAuthKeysSection.getByRole("button", { name: /Exportar chaves/ })).toBeDisabled();
    const runtimeAuthAuditSection = page.getByLabel("Auditoria de autenticação do runtime");
    await expect(runtimeAuthAuditSection.getByText("Auditoria de auth", { exact: true })).toBeVisible();
    await expect(runtimeAuthAuditSection).toContainText("chave local");
    await expect(runtimeAuthAuditSection).toContainText("configurada");
    await expect(runtimeAuthAuditSection).toContainText("Nenhum evento de auth carregado");
    await expect(runtimeAuthAuditSection.getByRole("button", { name: /Atualizar auditoria/ })).toBeDisabled();
    const turnOutputSection = page.getByLabel("Saída renderizada e raw");
    await expect(turnOutputSection.getByText("Saída do turno")).toBeVisible();
    await expect(turnOutputSection.getByText("Render", { exact: true })).toBeVisible();
    await expect(turnOutputSection.getByText("Raw", { exact: true })).toBeVisible();
    await expect(turnOutputSection.getByText("Schema guiado", { exact: true })).toBeVisible();
    const studioRuntimeSection = page.locator(".sandbox-section", { hasText: "Studio Local" });
    const sessionSection = page.locator(".sandbox-section", { hasText: "Sessão" });
    await liveEventsSection.getByLabel("Transporte de eventos").selectOption("sse");
    await studioRuntimeSection.getByRole("button", { name: /^Iniciar$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Sandbox ativo em http://127.0.0.1:19090", {
      timeout: 15_000,
    });
    await sessionSection.getByRole("button", { name: /^Criar$/ }).click();
    await expect(page.locator(".studio-metrics")).toContainText("awaiting_turn");
    await runtimeAuthKeysSection.getByRole("button", { name: /Atualizar chaves/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("3 chave(s) de auth carregada(s).");
    await expect(runtimeAuthKeysSection).toContainText("reference-interview");
    await expect(runtimeAuthKeysSection).toContainText("ativas");
    await expect(runtimeAuthKeysSection).toContainText("revogadas");
    await expect(runtimeAuthKeysSection).toContainText("expiradas");
    await expect(runtimeAuthKeysSection).toContainText("AGENT_API_KEYS_PATH:reader");
    await expect(runtimeAuthKeysSection).not.toContainText("ui-runtime-audit-key");
    const runtimeAuthKeysDownloadPromise = page.waitForEvent("download");
    await runtimeAuthKeysSection.getByRole("button", { name: /Exportar chaves/ }).click();
    const runtimeAuthKeysDownload = await runtimeAuthKeysDownloadPromise;
    expect(runtimeAuthKeysDownload.suggestedFilename()).toBe("runtime-auth-keys-reference-interview.afauthkeys.json");
    const runtimeAuthKeysPath = await runtimeAuthKeysDownload.path();
    expect(runtimeAuthKeysPath).toBeTruthy();
    const runtimeAuthKeysFileText = await fs.readFile(runtimeAuthKeysPath, "utf-8");
    const runtimeAuthKeysFile = JSON.parse(runtimeAuthKeysFileText);
    expect(runtimeAuthKeysFile.format).toBe("agent-flow-builder.runtime-auth-keys.v1");
    expect(runtimeAuthKeysFile.total).toBe(3);
    expect(runtimeAuthKeysFile.activeCount).toBe(1);
    expect(runtimeAuthKeysFile.revokedCount).toBe(1);
    expect(runtimeAuthKeysFile.expiredCount).toBe(1);
    expect(runtimeAuthKeysFile.governance).toMatchObject({
      sourceEndpoint: "/auth/keys",
      excludesRawKeyValues: true,
      excludesSecretValues: true,
      excludesEnvValues: true,
      excludesLocalFilePaths: true,
    });
    expect(runtimeAuthKeysFile.keys).toContainEqual(
      expect.objectContaining({
        keyId: "reader",
        source: "AGENT_API_KEYS_PATH",
        revocationIdentifier: "AGENT_API_KEYS_PATH:reader",
      }),
    );
    expect(runtimeAuthKeysFile.file).toMatchObject({ configured: true, exists: true, size: 192 });
    expect(runtimeAuthKeysFileText).not.toContain("ui-runtime-audit-key");
    expect(runtimeAuthKeysFileText).not.toContain(".agent-flow/api-keys.json");
    expect(runtimeAuthKeysFileText).not.toContain(".agent-flow/revoked-api-keys.json");
    const activeKeyCard = runtimeAuthKeysSection.locator(".runtime-auth-item").filter({ hasText: "AGENT_API_KEYS_PATH:reader" });
    await activeKeyCard.getByRole("button", { name: /Revogar no próximo start/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText(
      "AGENT_API_KEYS_PATH:reader preparado em AGENT_API_REVOKED_KEY_IDS",
    );
    await expect(secretsSection.getByText("AGENT_API_REVOKED_KEY_IDS")).toBeVisible();
    await expect(secretsSection.getByLabel("Secret local AGENT_API_REVOKED_KEY_IDS")).toHaveValue(
      '["AGENT_API_KEYS_PATH:reader"]',
    );
    await runtimeAuthAuditSection.getByRole("button", { name: /Atualizar auditoria/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("3 evento(s) de auth carregados.");
    await expect(runtimeAuthAuditSection).toContainText("allowed");
    await expect(runtimeAuthAuditSection).toContainText("rate_limited");
    await expect(runtimeAuthAuditSection).toContainText("key-1");
    await expect(runtimeAuthAuditSection).not.toContainText("ui-runtime-audit-key");
    await sessionSection.getByLabel("Idempotency key do turno").fill("ui-audit-turn-key");
    await sessionSection.getByRole("button", { name: /^Enviar turno$/ }).click();
    const turnStreamSection = page.locator(".studio-turn-stream");
    await expect(turnStreamSection).toContainText("Resposta em streaming");
    await expect(turnStreamSection).toContainText("2 token(s)");
    await expect(turnStreamSection).toContainText("callback do runtime");
    await expect(turnStreamSection).toContainText("Stream encerrado: turn_completed.");
    await expect(turnStreamSection.locator("pre")).toContainText("Resposta incremental finalizada com chave controlada.");
    await expect(turnStreamSection).toHaveClass(/completed/);
    await runtimeJobsSection.getByRole("button", { name: /Atualizar jobs/ }).click();
    await expect(runtimeJobsSection).toContainText("Worker: python -m app.worker; ciclo 5s; lote 20; lease 60s; cleanup automático off");
    await expect(runtimeJobsSection).toContainText("Retry/concorrência: retry 5s; claim/lease ativo");
    await expect(runtimeJobsSection).toContainText("Retenção: succeeded, failed; idade 168h; limite 100");
    await expect(runtimeJobsSection).toContainText("Schedules: intervalo, cron básico, evento");
    await expect(runtimeJobsSection).toContainText("post_finish_summary");
    await expect(runtimeJobsSection).toContainText("Adiar 10 min");
    await expect(runtimeJobsSection).toContainText("Repetir 1 h");
    await expect(runtimeJobsSection).toContainText("Cron 9h");
    await expect(runtimeJobsSection).toContainText("Evento fim");
    await expect(runtimeJobsSection.getByRole("button", { name: /Prévia limpeza 7d/ })).toBeEnabled();
    await expect(runtimeJobsSection.getByRole("button", { name: /^Limpar 7d$/ })).toBeDisabled();
    await runtimeJobsSection.getByRole("button", { name: /Prévia limpeza 7d/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Prévia de limpeza: 1 job(s)");
    await expect(runtimeJobsSection).toContainText("Limpeza: prévia");
    await expect(runtimeJobsSection).toContainText("encontrados 1");
    await expect(runtimeJobsSection).toContainText("succeeded 1");
    await expect(runtimeJobsSection.getByRole("button", { name: /^Limpar 7d$/ })).toBeEnabled();
    await runtimeJobsSection.getByRole("button", { name: /^Limpar 7d$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("1 job(s) antigo(s) removido(s).");
    await expect(runtimeJobsSection).toContainText("Limpeza: executada");
    await expect(runtimeJobsSection).toContainText("removidos 1");
    await expect(runtimeJobsSection.getByRole("button", { name: /Salvar snapshot/ })).toBeEnabled();
    await runtimeJobsSection.getByRole("button", { name: /Salvar snapshot/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Snapshot de jobs salvo", { timeout: 10_000 });
    await expect(runtimeJobsSection).toContainText(/[1-9]\d* snapshot\(s\)/);
    const storedRuntimeJobMetricsHistory = await page.evaluate(() => {
      const raw = window.localStorage.getItem("agent-flow-builder.runtime-job-metrics-history.reference-interview");
      return raw ? JSON.parse(raw) : null;
    });
    expect(storedRuntimeJobMetricsHistory.format).toBe("agent-flow-builder.runtime-job-metrics-history.v1");
    expect(storedRuntimeJobMetricsHistory.snapshotCount).toBeGreaterThanOrEqual(1);
    expect(storedRuntimeJobMetricsHistory.snapshots[0].summary.pendingDue).toBe(1);
    expect(storedRuntimeJobMetricsHistory.snapshots[0].metrics.total).toBe(1);
    expect(storedRuntimeJobMetricsHistory.governance.includesRawJobPayloads).toBe(false);
    const runtimeJobMetricsHistoryDownloadPromise = page.waitForEvent("download");
    await runtimeJobsSection.getByRole("button", { name: /Exportar histórico/ }).click();
    const runtimeJobMetricsHistoryDownload = await runtimeJobMetricsHistoryDownloadPromise;
    await expect(page.locator("footer[role='status']")).toContainText("Histórico de jobs exportado com");
    expect(runtimeJobMetricsHistoryDownload.suggestedFilename()).toBe("reference-interview-runtime-job-metrics.afjobmetrics.json");
    const runtimeJobMetricsHistoryPath = await runtimeJobMetricsHistoryDownload.path();
    expect(runtimeJobMetricsHistoryPath).toBeTruthy();
    const runtimeJobMetricsHistoryFile = JSON.parse(await fs.readFile(runtimeJobMetricsHistoryPath, "utf-8"));
    expect(runtimeJobMetricsHistoryFile.format).toBe("agent-flow-builder.runtime-job-metrics-history.v1");
    expect(runtimeJobMetricsHistoryFile.snapshotCount).toBeGreaterThanOrEqual(1);
    expect(runtimeJobMetricsHistoryFile.governance.includesRawJobPayloads).toBe(false);
    expect(runtimeJobMetricsHistoryFile.governance.includesRawJobResults).toBe(false);
    const runtimeJobMetricsHistoryDiffDownloadPromise = page.waitForEvent("download");
    await page
      .getByLabel("Comparar histórico governado de métricas de jobs")
      .setInputFiles(runtimeJobMetricsHistoryPath);
    const runtimeJobMetricsHistoryDiffDownload = await runtimeJobMetricsHistoryDiffDownloadPromise;
    expect(runtimeJobMetricsHistoryDiffDownload.suggestedFilename()).toMatch(
      /^reference-interview-runtime-job-metrics-diff-.*\.afjobmetrics-diff\.json$/,
    );
    const runtimeJobMetricsHistoryDiffPath = await runtimeJobMetricsHistoryDiffDownload.path();
    expect(runtimeJobMetricsHistoryDiffPath).toBeTruthy();
    const runtimeJobMetricsHistoryDiffFile = JSON.parse(await fs.readFile(runtimeJobMetricsHistoryDiffPath, "utf-8"));
    expect(runtimeJobMetricsHistoryDiffFile.format).toBe("agent-flow-builder.runtime-job-metrics-history-diff.v1");
    expect(runtimeJobMetricsHistoryDiffFile.summary.unchangedCount).toBeGreaterThanOrEqual(1);
    expect(runtimeJobMetricsHistoryDiffFile.governance.excludesRawJobPayloads).toBe(true);
    expect(JSON.stringify(runtimeJobMetricsHistoryDiffFile)).not.toContain('"payload"');
    expect(JSON.stringify(runtimeJobMetricsHistoryDiffFile)).not.toContain('"result"');
    expect(JSON.stringify(runtimeJobMetricsHistoryDiffFile)).not.toContain('"last_error"');
    const primaryJobCard = runtimeJobsSection
      .locator(".runtime-job-list")
      .first()
      .locator(".runtime-job-item", { hasText: "job-ui-schedule" });
    await primaryJobCard.getByRole("button", { name: /^Adiar 10 min$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("reagendado para 2026-07-02T15:10:00+00:00");
    await expect(runtimeJobsSection).toContainText("2026-07-02T15:10:00+00:00");
    await primaryJobCard.getByRole("button", { name: /^Repetir 1 h$/ }).click();
    await expect(runtimeJobsSection).toContainText("schedule-ui-hour");
    await expect(runtimeJobsSection).toContainText("1h");
    await runtimeJobsSection.getByRole("button", { name: /^Enfileirar vencidas$/ }).click();
    await expect(runtimeJobsSection).toContainText("job-ui-recurring-1");
    await runtimeJobsSection.getByRole("button", { name: /^Desativar$/ }).click();
    await expect(runtimeJobsSection).toContainText("disabled");
    await primaryJobCard.getByRole("button", { name: /^Cron 9h$/ }).click();
    await expect(runtimeJobsSection).toContainText("schedule-ui-cron");
    await expect(runtimeJobsSection).toContainText("0 9 * * *");
    await primaryJobCard.getByRole("button", { name: /^Evento fim$/ }).click();
    await expect(runtimeJobsSection).toContainText("schedule-ui-event");
    await expect(runtimeJobsSection).toContainText("session.finished");
    await runtimeJobsSection.getByRole("button", { name: /^Disparar fim$/ }).click();
    await expect(runtimeJobsSection).toContainText("job-ui-event-1");

    await page.getByRole("button", { name: /ui-audit-error/ }).click();
    await expect(studioGlobalStatus).toContainText("Falha em input_safety_check");
    await expect(studioGlobalStatus.getByRole("button", { name: /^Abrir falha$/ })).toBeVisible();
    await expect(turnOutputSection.locator(".studio-output-render")).toContainText("Qual conteúdo devemos avaliar?");
    await expect(turnOutputSection.locator(".studio-output-raw")).toContainText("node_failed");
    await expect(page.getByLabel("Filtrar timeline por agente")).toHaveValue("support-agent");
    await expect(page.getByRole("button", { name: /#3\s+node_failed/ })).toBeVisible();
    await page.getByRole("button", { name: /#3\s+node_failed/ }).click();
    const liveInputSafetyNode = liveExecutionSection.getByRole("button", { name: /input_safety_check/ });
    await expect(liveInputSafetyNode).toHaveAttribute("aria-pressed", "true");
    await expect(liveInputSafetyNode).toContainText("node_failed");
    await expect(liveInputSafetyNode).toContainText("selecionado na timeline");
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
    await openInspectorTab(page, "Editar");
    await page.locator(".canvas-node-chip", { hasText: "input_safety_check" }).click();
    const guidedNodeDebug = page.getByLabel("Debug guiado do nó");
    await expect(guidedNodeDebug).toContainText("Debug guiado");
    await expect(guidedNodeDebug).toContainText("Falha no nó");
    await expect(guidedNodeDebug).toContainText("origem da falha");
    await expect(guidedNodeDebug).toContainText("sem pin");
    await expect(guidedNodeDebug.getByRole("button", { name: /#3/ })).toContainText("node_failed");
    await page.getByLabel("Ações da seleção do canvas").getByRole("button", { name: "Depurar" }).click();
    await expect(page.locator(".tabs button", { hasText: "Studio" })).toHaveClass(/active/);
    await expect(page.getByLabel("Filtrar timeline por nó")).toHaveValue("input_safety_check");
    await expect(page.locator(".sandbox-section", { hasText: "Contexto do nó" })).toContainText("input_safety_check");
    await expect(page.locator("footer[role='status']")).toContainText("Studio aberto para depurar input_safety_check");

    await page.getByRole("button", { name: /ui-audit-ok/ }).click();
    await expect(turnOutputSection.locator(".studio-output-render")).toContainText("Plano gerado com próximos passos.");
    await expect(turnOutputSection.locator(".studio-output-raw")).toContainText("Pergunta gerada");
    await expect(turnOutputSection).toContainText("turn_output");
    await expect(turnOutputSection).toContainText("assistant_message.text");
    await expect(turnOutputSection).toContainText("safety.blocked");
    await expect(turnOutputSection).toContainText("4/5 campo(s) aderentes");
    await page.getByLabel("Filtrar timeline por agente").selectOption("support-agent");
    const timelineEmptyState = page.getByLabel("Timeline vazia");
    await expect(timelineEmptyState).toContainText("Nenhum evento neste filtro");
    await expect(timelineEmptyState).toContainText("Remova os filtros");
    await timelineEmptyState.getByRole("button", { name: /^Mostrar todos$/ }).click();
    await expect(page.getByLabel("Filtrar timeline por agente")).toHaveValue("");
    await page.getByLabel("Filtrar timeline por agente").selectOption("reference-interview");
    const toolManagerSection = page.getByLabel("Tool manager");
    const deterministicTool = toolManagerSection.locator(".studio-tool-manager-item", { hasText: "deterministic_gate" });
    await expect(deterministicTool).toBeVisible();
    await expect(deterministicTool).toContainText("code · native");
    await expect(deterministicTool).toContainText("runtime_process · in_process");
    await expect(deterministicTool).toContainText("#6 · node_completed");
    await expect(deterministicTool).toContainText("sem pin");
    await deterministicTool.getByRole("button", { name: /^Depurar$/ }).click();
    await expect(page.getByLabel("Filtrar timeline por nó")).toHaveValue("deterministic_gate");
    await expect(page.locator(".sandbox-section", { hasText: "Contexto do nó" })).toContainText("deterministic_gate");
    await toolManagerSection.getByRole("button", { name: /^Limpar filtro$/ }).click();
    await expect(page.getByLabel("Filtrar timeline por agente")).toHaveValue("reference-interview");
    await expect(liveExecutionSection).toContainText("openai");
    await expect(liveExecutionSection).toContainText("gpt-4.1-mini");
    await expect(liveExecutionSection).toContainText("168 tokens");
    await expect(liveExecutionSection).toContainText("$0.0024");
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
    await expect(structuredLogCard.locator("small", { hasText: /^sandbox subprocess_stdio/ })).toBeVisible();
    await structuredLogsSection.getByLabel("Buscar logs estruturados").fill("generate_questions");
    await structuredLogsSection.getByLabel("Filtrar logs estruturados por modo").selectOption("mcp");
    await structuredLogsSection.getByLabel("Filtrar logs estruturados por status").selectOption("custom_code_executed");
    await structuredLogsSection.getByLabel("Filtrar logs estruturados por sandbox").selectOption("subprocess_stdio");
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
    expect(structuredLogsExport.filters.sandbox).toBe("subprocess_stdio");
    expect(structuredLogsExport.logs[0].mode).toBe("mcp");
    expect(structuredLogsExport.logs[0].status).toBe("custom_code_executed");
    expect(structuredLogsExport.logs[0].sandboxIsolation).toBe("subprocess_stdio");
    expect(structuredLogsExport.logs[0].sandboxBoundary).toBe("process");
    await page.getByRole("button", { name: /ui-audit-sandbox-error/ }).click();
    const sandboxTelemetry = page.getByLabel("Telemetria histórica de sandbox");
    await expect(sandboxTelemetry).toBeVisible();
    await expect(sandboxTelemetry).toContainText("Histórico de sandbox");
    await expect(sandboxTelemetry).toContainText("deterministic_gate");
    await expect(sandboxTelemetry).toContainText("file · dedicated_process");
    await expect(sandboxTelemetry).toContainText("python");
    await expect(sandboxTelemetry).toContainText("stdin_stdout_json");
    await expect(sandboxTelemetry).toContainText("Entry point não encontrado");
    const [sandboxTelemetryDownload] = await Promise.all([
      page.waitForEvent("download"),
      sandboxTelemetry.getByRole("button", { name: /^Exportar telemetria$/ }).click(),
    ]);
    expect(sandboxTelemetryDownload.suggestedFilename()).toBe(
      "studio-sandbox-telemetry-reference-interview.afsandboxtelemetry.json",
    );
    const sandboxTelemetryPath = await sandboxTelemetryDownload.path();
    if (!sandboxTelemetryPath) {
      throw new Error("Sandbox telemetry download path was not available.");
    }
    const sandboxTelemetryExport = JSON.parse(await fs.readFile(sandboxTelemetryPath, "utf8"));
    expect(sandboxTelemetryExport.format).toBe("agent-flow-builder.studio-sandbox-telemetry-export.v1");
    expect(sandboxTelemetryExport.report.format).toBe("agent-flow-builder.studio-sandbox-telemetry.v1");
    expect(sandboxTelemetryExport.report.flowId).toBe("reference-interview");
    expect(sandboxTelemetryExport.report.failureCount).toBeGreaterThanOrEqual(1);
    expect(sandboxTelemetryExport.governance.includesRawEvents).toBe(false);
    expect(sandboxTelemetryExport.governance.includesSecrets).toBe(false);
    expect(sandboxTelemetryExport.governance.includesEnvValues).toBe(false);
    expect(sandboxTelemetryExport.governance.includesSandboxWorkspaceFiles).toBe(false);
    const sandboxFailureOverview = page.getByLabel("Falhas agregadas de sandbox");
    await expect(sandboxFailureOverview).toBeVisible();
    await expect(sandboxFailureOverview).toContainText("deterministic_gate");
    await expect(sandboxFailureOverview).toContainText("file · dedicated_process");
    await expect(sandboxFailureOverview).toContainText("python");
    await expect(sandboxFailureOverview).toContainText("stdin_stdout_json");
    await expect(sandboxFailureOverview).toContainText("Entry point não encontrado");
    await sandboxFailureOverview.getByRole("button", { name: /^Abrir nó$/ }).click();
    await expect(page.getByLabel("Filtrar timeline por nó")).toHaveValue("deterministic_gate");
    const sandboxFailureSection = page.getByLabel("Falhas de sandbox do nó");
    await expect(sandboxFailureSection).toBeVisible();
    await expect(sandboxFailureSection).toContainText("file · dedicated_process");
    await expect(sandboxFailureSection).toContainText("Entry point do código não foi encontrado");
    await expect(sandboxFailureSection).toContainText("Entry point não encontrado");
    await expect(sandboxFailureSection).toContainText("Confira codeEntry/handler e o nome exportado no arquivo.");
    await expect(sandboxFailureSection).toContainText("stdin_stdout_json");
    await sandboxFailureSection.getByRole("button", { name: /^Ver logs$/ }).click();
    const sandboxFailureLogsSection = page.locator(".node-context-section", { hasText: "Logs estruturados" });
    await expect(sandboxFailureLogsSection.getByLabel("Filtrar logs estruturados por status")).toHaveValue("custom_code_failed");
    await expect(sandboxFailureLogsSection.getByLabel("Filtrar logs estruturados por sandbox")).toHaveValue("dedicated_process");
    await expect(sandboxFailureLogsSection.getByLabel("Buscar logs estruturados")).toHaveValue(/Entry point/);
    await expect(sandboxFailureLogsSection.getByText("1/1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /ui-audit-ok/ }).click();
    await page.getByRole("button", { name: /#4\s+llm_completed/ }).click();
    await expect(page.getByText("Restore de checkpoint", { exact: true })).toBeVisible();
    await expect(page.getByText(/Origem: snapshot.*sessão ui-audit-source.*turno 1/)).toBeVisible();
    await expect(page.getByText(/Estado: session, recent_messages, nodes/)).toBeVisible();
    await page.getByRole("button", { name: /ui-audit-error/ }).click();
    await page.getByRole("combobox", { name: /Comparar com/ }).selectOption("run-ui-audit-ok");
    await page.getByRole("button", { name: /^Comparar$/ }).click();
    const comparisonSection = page.locator(".studio-comparison-item", { hasText: "Comparação" });
    await expect(comparisonSection.getByText("Regressão funcional detectada.", { exact: true })).toBeVisible();
    await expect(comparisonSection.getByText("tokens", { exact: true })).toBeVisible();
    await expect(comparisonSection.getByText(/168 para -/)).toBeVisible();
    const regressionAlertInbox = comparisonSection.getByLabel("Inbox de alertas de regressão");
    await expect(regressionAlertInbox).toContainText(/\d+ aberto\(s\) · \d+ retido\(s\)/);
    await regressionAlertInbox.getByLabel("Retenção de alertas de regressão").selectOption("7");
    await regressionAlertInbox.getByRole("button", { name: /^Registrar regressão$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Alerta de regressão registrado");
    await expect(regressionAlertInbox).toContainText("1 aberto(s) · 1 retido(s)");
    await expect
      .poll(async () => {
        const response = await page.request.get(`${apiUrl}/flows/reference-interview/regression-alerts`);
        const payload = await response.json();
        const items = Array.isArray(payload.items) ? payload.items : [];
        const alert = items.find((item) => item.candidateRunId === "run-ui-audit-error");
        return `${payload.openCount}:${payload.alertCount}:${alert?.status ?? "missing"}`;
      })
      .toBe("1:1:open");
    const storedRegressionAlerts = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("agent-flow-builder.regression-alerts.reference-interview") || "null"),
    );
    expect(storedRegressionAlerts.format).toBe("agent-flow-builder.regression-alerts.v1");
    expect(storedRegressionAlerts.alertCount).toBe(1);
    expect(storedRegressionAlerts.openCount).toBe(1);
    expect(storedRegressionAlerts.items[0].candidateRunId).toBe("run-ui-audit-error");
    expect(storedRegressionAlerts.items[0].baselineRunId).toBe("run-ui-audit-ok");
    expect(storedRegressionAlerts.items[0].metrics.nodeTypeThresholdCount).toBeGreaterThanOrEqual(0);
    expect(storedRegressionAlerts.items[0].appliedThresholds.nodeTypeThresholds).toBeTruthy();
    const [regressionAlertsDownload] = await Promise.all([
      page.waitForEvent("download"),
      regressionAlertInbox.getByRole("button", { name: /^Exportar alertas$/ }).click(),
    ]);
    expect(regressionAlertsDownload.suggestedFilename()).toBe(
      "studio-regression-alerts-reference-interview.afregressionalerts.json",
    );
    const regressionAlertsPath = await regressionAlertsDownload.path();
    if (!regressionAlertsPath) {
      throw new Error("Regression alerts download path was not available.");
    }
    const regressionAlertsFile = JSON.parse(await fs.readFile(regressionAlertsPath, "utf8"));
    expect(regressionAlertsFile.format).toBe("agent-flow-builder.regression-alerts.v1");
    expect(regressionAlertsFile.retentionPolicy.excludesRawRuns).toBe(true);
    expect(regressionAlertsFile.retentionPolicy.excludesRawNodePayloads).toBe(true);
    expect(regressionAlertsFile.retentionPolicy.excludesSecretValues).toBe(true);
    expect(regressionAlertsFile.items[0]).not.toHaveProperty("left");
    expect(regressionAlertsFile.items[0]).not.toHaveProperty("right");
    await regressionAlertInbox.getByRole("button", { name: /^Reconhecer abertos$/ }).click();
    await expect(regressionAlertInbox).toContainText("0 aberto(s) · 1 retido(s)");
    await expect
      .poll(async () => {
        const response = await page.request.get(`${apiUrl}/flows/reference-interview/regression-alerts`);
        const payload = await response.json();
        const items = Array.isArray(payload.items) ? payload.items : [];
        const alert = items.find((item) => item.candidateRunId === "run-ui-audit-error");
        return `${payload.openCount}:${payload.alertCount}:${alert?.status ?? "missing"}`;
      })
      .toBe("0:1:acknowledged");
    const layeredComparison = comparisonSection.getByLabel("Resumo multi-camadas de debug");
    await expect(layeredComparison).toContainText("Fluxo e execução");
    await expect(layeredComparison).toContainText("Estado/output");
    await expect(layeredComparison).toContainText("Pins e mocks");
    await expect(layeredComparison).toContainText("Checkpoints/cenários");
    await expect(layeredComparison).toContainText(/\d+ nó\(s\) alterado\(s\)/);
    await page.getByRole("button", { name: /#3\s+node_failed/ }).click();
    await expect(layeredComparison).toContainText("input_safety_check");
    await expect(layeredComparison).toContainText("Crie um cenário de debug do candidato");
    await expect(layeredComparison.getByRole("button", { name: /^Focar nó$/ })).toBeVisible();
    await expect(layeredComparison.getByRole("button", { name: /^Criar cenário$/ })).toBeVisible();
    await expect(layeredComparison.getByRole("button", { name: /^Exportar replay$/ })).toBeVisible();
    await expect(layeredComparison.getByRole("button", { name: /^Focar falha$/ })).toBeVisible();
    await expect(
      layeredComparison.getByRole("button", { name: /^Compartilhar resumo multi-camadas da comparação$/ }),
    ).toBeVisible();
    await expect(layeredComparison.getByRole("button", { name: /^Central$/ })).toBeVisible();
    await expect(layeredComparison.getByRole("button", { name: /^Sync central$/ })).toBeVisible();
    await layeredComparison.getByRole("button", { name: /^Compartilhar resumo multi-camadas da comparação$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText(/Camadas de debug compartilhadas: \d+ snapshot\(s\)/);
    await expect(layeredComparison).toContainText(/\d+ snapshot\(s\) compartilhado\(s\).*synced/);
    await page.waitForTimeout(10);
    await layeredComparison.getByRole("button", { name: /^Compartilhar resumo multi-camadas da comparação$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText(/Camadas de debug compartilhadas: \d+ snapshot\(s\).*conflito\(s\)/);
    const debugLayerConflicts = page.getByLabel("Conflitos de camadas de debug");
    await expect(debugLayerConflicts).toContainText("Conflitos de camadas");
    await expect(debugLayerConflicts).toContainText(/snapshot\(s\)/);
    await expect(debugLayerConflicts.getByRole("button", { name: /^Manter mais recente$/ })).toBeVisible();
    await expect(debugLayerConflicts.getByRole("button", { name: /^Manter este snapshot$/ }).first()).toBeVisible();
    await expect(layeredComparison.getByRole("button", { name: /^Exportar revisão governada de conflitos de camadas$/ })).toBeVisible();
    await expect(layeredComparison.getByRole("button", { name: /^Comparar revisão governada de conflitos de camadas$/ })).toBeVisible();
    const debugLayerReviewDownloadPromise = page.waitForEvent("download");
    await layeredComparison.getByRole("button", { name: /^Exportar revisão governada de conflitos de camadas$/ }).click();
    const debugLayerReviewDownload = await debugLayerReviewDownloadPromise;
    expect(debugLayerReviewDownload.suggestedFilename()).toMatch(
      /^studio-debug-layer-conflicts-reference-interview-[a-f0-9]+\.afdebuglayer-conflicts\.json$/,
    );
    const debugLayerReviewPath = await debugLayerReviewDownload.path();
    expect(debugLayerReviewPath).toBeTruthy();
    const debugLayerReviewText = await fs.readFile(debugLayerReviewPath, "utf8");
    const debugLayerReview = JSON.parse(debugLayerReviewText);
    expect(debugLayerReview.format).toBe("agent-flow-builder.debug-layer-snapshots-conflict-review.v1");
    expect(debugLayerReview.conflictCount).toBeGreaterThanOrEqual(1);
    expect(debugLayerReview.governance.excludesSnapshots).toBe(true);
    expect(debugLayerReview.governance.excludesEvidence).toBe(true);
    expect(debugLayerReview.governance.excludesRawNodePayloads).toBe(true);
    expect(debugLayerReviewText).not.toContain('"snapshots"');
    expect(debugLayerReviewText).not.toContain('"snapshot"');
    expect(debugLayerReviewText).not.toContain('"evidence"');
    expect(debugLayerReviewText).not.toContain('"payload"');
    expect(debugLayerReviewText).not.toContain('"input"');
    expect(debugLayerReviewText).not.toContain('"output"');
    const debugLayerReviewFileChooserPromise = page.waitForEvent("filechooser");
    await layeredComparison.getByRole("button", { name: /^Comparar revisão governada de conflitos de camadas$/ }).click();
    const debugLayerReviewFileChooser = await debugLayerReviewFileChooserPromise;
    const debugLayerReviewDiffDownloadPromise = page.waitForEvent("download");
    await debugLayerReviewFileChooser.setFiles(debugLayerReviewPath);
    const debugLayerReviewDiffDownload = await debugLayerReviewDiffDownloadPromise;
    expect(debugLayerReviewDiffDownload.suggestedFilename()).toMatch(
      /^studio-debug-layer-conflicts-diff-reference-interview-[a-f0-9]+\.afdebuglayer-conflicts-diff\.json$/,
    );
    const debugLayerReviewDiffPath = await debugLayerReviewDiffDownload.path();
    expect(debugLayerReviewDiffPath).toBeTruthy();
    const debugLayerReviewDiffText = await fs.readFile(debugLayerReviewDiffPath, "utf8");
    const debugLayerReviewDiff = JSON.parse(debugLayerReviewDiffText);
    expect(debugLayerReviewDiff.format).toBe("agent-flow-builder.debug-layer-snapshots-conflict-review-diff.v1");
    expect(debugLayerReviewDiff.governance.excludesSnapshots).toBe(true);
    expect(debugLayerReviewDiff.governance.excludesEvidence).toBe(true);
    expect(debugLayerReviewDiff.governance.excludesRawNodePayloads).toBe(true);
    expect(debugLayerReviewDiffText).not.toContain('"snapshots"');
    expect(debugLayerReviewDiffText).not.toContain('"snapshot"');
    expect(debugLayerReviewDiffText).not.toContain('"evidence"');
    expect(debugLayerReviewDiffText).not.toContain('"payload"');
    expect(debugLayerReviewDiffText).not.toContain('"input"');
    expect(debugLayerReviewDiffText).not.toContain('"output"');
    await debugLayerConflicts.getByRole("button", { name: /^Manter este snapshot$/ }).first().click();
    await expect(page.locator("footer[role='status']")).toContainText("Conflito de camadas resolvido");
    await expect(page.getByLabel("Conflitos de camadas de debug")).toHaveCount(0);
    await layeredComparison.getByRole("button", { name: /^Central$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Central de camadas:");
    await expect(layeredComparison).toContainText(/central off|central configurada/);
    const [runLayerDownload] = await Promise.all([
      page.waitForEvent("download"),
      layeredComparison.getByRole("button", { name: /^Exportar resumo multi-camadas da comparação$/ }).click(),
    ]);
    expect(runLayerDownload.suggestedFilename()).toMatch(/^studio-debug-layers-reference-interview-.*\.afdebuglayers\.json$/);
    const runLayerPath = await runLayerDownload.path();
    expect(runLayerPath).toBeTruthy();
    const runLayerFile = JSON.parse(await fs.readFile(runLayerPath, "utf-8"));
    expect(runLayerFile.format).toBe("agent-flow-builder.debug-layer-summary.v1");
    expect(runLayerFile.scope).toBe("run_comparison");
    expect(runLayerFile.flow.id).toBe("reference-interview");
    expect(runLayerFile.summary.items).toHaveLength(6);
    expect(runLayerFile.evidence.selectedNode.nodeId).toBe("input_safety_check");
    expect(runLayerFile.governance.excludesRawNodePayloads).toBe(true);
    expect(runLayerFile.governance.excludesSecretValues).toBe(true);
    const selectedNodeComparison = page.getByLabel("Comparação do nó selecionado");
    await expect(selectedNodeComparison).toContainText("alterado");
    await expect(selectedNodeComparison).toContainText("run-ui-audit-ok");
    await expect(selectedNodeComparison).toContainText("run-ui-audit-error");
    await expect(selectedNodeComparison).toContainText("state");
    await expect(selectedNodeComparison).toContainText("output");
    const [debugReplayDownload] = await Promise.all([
      page.waitForEvent("download"),
      selectedNodeComparison.getByRole("button", { name: /^Exportar replay$/ }).click(),
    ]);
    expect(debugReplayDownload.suggestedFilename()).toMatch(
      /^studio-debug-replay-reference-interview-input_safety_check-.*\.afdebugreplay\.json$/,
    );
    const debugReplayPath = await debugReplayDownload.path();
    expect(debugReplayPath).toBeTruthy();
    const debugReplayFile = JSON.parse(await fs.readFile(debugReplayPath, "utf-8"));
    expect(debugReplayFile.format).toBe("agent-flow-builder.debug-replay-artifact.v1");
    expect(debugReplayFile.flow.id).toBe("reference-interview");
    expect(debugReplayFile.runComparison.leftRunId).toBe("run-ui-audit-ok");
    expect(debugReplayFile.runComparison.rightRunId).toBe("run-ui-audit-error");
    expect(debugReplayFile.selectedNode.nodeId).toBe("input_safety_check");
    expect(debugReplayFile.selectedNode.comparisonStatus).toBe("changed");
    const replayDiffPreview = [
      ...debugReplayFile.selectedNode.stateDiffPreview,
      ...debugReplayFile.selectedNode.outputDiffPreview,
    ];
    expect(replayDiffPreview.length).toBeGreaterThan(0);
    expect(replayDiffPreview[0]).toHaveProperty("path");
    expect(replayDiffPreview[0]).not.toHaveProperty("before");
    expect(replayDiffPreview[0]).not.toHaveProperty("after");
    expect(debugReplayFile.replay.recommendedAction).toMatch(/create_debug_scenario|run_existing_checkpoint|refresh_stale_pins|inspect_only/);
    expect(debugReplayFile.replay.candidateCheckpoint).toMatchObject({
      sourceRunId: "run-ui-audit-error",
      sourceSessionId: "ui-audit-error",
      eventSeq: 3,
      nodeId: "input_safety_check",
    });
    expect(debugReplayFile.governance.excludesRawNodePayloads).toBe(true);
    expect(debugReplayFile.governance.excludesRawPinPayloads).toBe(true);
    expect(debugReplayFile.governance.excludesRawCheckpointState).toBe(true);
    expect(debugReplayFile.governance.excludesSecretValues).toBe(true);
    const replayArtifactsPanel = page.getByLabel("Artefatos de replay governado");
    await expect(replayArtifactsPanel).toContainText("Nenhum replay importado");
    const [debugReplayChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      replayArtifactsPanel.getByRole("button", { name: /^Importar replay$/ }).click(),
    ]);
    await debugReplayChooser.setFiles(debugReplayPath);
    await expect(replayArtifactsPanel).toContainText("Replay input_safety_check importado.");
    await expect(replayArtifactsPanel).toContainText("input_safety_check");
    await expect(replayArtifactsPanel).toContainText("run-ui-audit-ok");
    await expect(replayArtifactsPanel).toContainText("run-ui-audit-error");
    await expect(replayArtifactsPanel).toContainText("sem payload bruto");
    await expect(replayArtifactsPanel).toContainText("crie cenário de revisão");
    await replayArtifactsPanel.getByRole("button", { name: /^Focar nó$/ }).click();
    await expect(page.getByLabel("Filtrar timeline por nó")).toHaveValue("input_safety_check");
    await replayArtifactsPanel.getByRole("button", { name: /^Criar cenário$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Cenário de replay criado para input_safety_check.");
    await expect(replayArtifactsPanel).toContainText("Replay input_safety_check");
    await replayArtifactsPanel.getByRole("button", { name: /^Selecionar cenário$/ }).click();
    const replayScenarioSection = page.locator(".sandbox-section", { hasText: "Cenários de teste" });
    const replayScenarioCard = replayScenarioSection.locator("article.runtime-item", { hasText: "Replay input_safety_check" });
    await expect(replayScenarioCard.getByText(/Origem: reference-interview.*replay importado.*run-ui-audit-error.*input_safety_check#3/)).toBeVisible();
    await expect(replayScenarioCard.getByText(/Fork de checkpoint: run-ui-audit-error.*#3.*input_safety_check/)).toBeVisible();
    await expect(replayScenarioCard.getByText(/replay, debug, artefato, input_safety_check/)).toBeVisible();
    await replayScenarioSection.getByRole("button", { name: /^Remover$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Cenário removido.");
    await selectedNodeComparison.getByRole("button", { name: /^Criar cenário de debug$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText(
      "Cenário de debug criado para input_safety_check a partir de run-ui-audit-error",
    );
    const debugScenarioSection = page.locator(".sandbox-section", { hasText: "Cenários de teste" });
    const debugScenarioCard = debugScenarioSection.locator("article.runtime-item", { hasText: "Debug input_safety_check" });
    await expect(debugScenarioCard.getByText(/Fork de checkpoint: run-ui-audit-error.*#3.*input_safety_check/)).toBeVisible();
    await expect(debugScenarioCard.getByText(/debug, comparacao, input_safety_check/)).toBeVisible();
    await debugScenarioSection.getByRole("button", { name: /^Remover$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Cenário removido.");
    await page.getByRole("button", { name: /ui-audit-ok/ }).click();
    await page.getByRole("button", { name: /#4\s+llm_completed/ }).click();
    const llmDiagnosisSection = page.locator(".node-context-diagnosis", { hasText: "Diagnóstico" });
    await expect(llmDiagnosisSection.getByText("Sem falha associada")).toBeVisible();
    await expect(llmDiagnosisSection.getByText(/O nó LLM completou sem erro aparente/)).toBeVisible();
    await page.getByRole("button", { name: /^Fixar IO$/ }).click();
    await expect(page.getByText("Dados do nó llm_step fixados para replay local.")).toBeVisible();
    const nodePinsSection = page.locator(".sandbox-section", { hasText: "Pins de nó" });
    const nodePinsSharedCard = nodePinsSection.locator(".shared-sync-card").last();
    await expect(nodePinsSharedCard.getByText("Compartilhamento")).toBeVisible();
    await expect(nodePinsSharedCard.getByRole("button", { name: /^Carregar pins$/ })).toBeVisible();
    await expect(nodePinsSharedCard.getByRole("button", { name: /^Sincronizar pins$/ })).toBeVisible();
    await expect(nodePinsSharedCard.getByRole("button", { name: /^Exportar revisão$/ })).toBeVisible();
    await expect(nodePinsSharedCard.getByRole("button", { name: /^Comparar revisão$/ })).toBeVisible();
    await expect(nodePinsSharedCard.getByRole("button", { name: /^Central$/ })).toBeVisible();
    await expect(nodePinsSharedCard.getByRole("button", { name: /^Sync central$/ })).toBeVisible();
    await expect(nodePinsSharedCard.getByText(/Central de pins/)).toBeVisible();
    await expect(nodePinsSharedCard.getByText(/redige chaves sensíveis/)).toBeVisible();
    await expect(nodePinsSection.getByText("llm_step", { exact: true })).toBeVisible();
    await expect(nodePinsSection.getByText(/llm_prompt.*#4.*llm_completed/)).toBeVisible();
    await expect(nodePinsSection.getByText(/atual/).first()).toBeVisible();
    await nodePinsSharedCard.getByRole("button", { name: /^Sincronizar pins$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Pins sincronizados");
    const conflictingNodePinsResponse = await request.post(`${apiUrl}/flows/reference-interview/studio-node-pins/merge`, {
      data: {
        format: "agent-flow-builder.studio-node-pins.v1",
        flowId: "reference-interview",
        pins: [
          {
            id: "pin-ui-audit-conflict",
            nodeId: "llm_step",
            nodeType: "llm_prompt",
            runId: "run-ui-audit-conflict",
            sessionId: "ui-audit-conflict",
            eventSeq: 9,
            eventType: "llm_completed",
            nodeHash: "ui-audit-conflict-node-hash",
            input: { prompt: "Versão compartilhada divergente", api_key: "ui-secret-key" },
            output: { answer: "Alternativa compartilhada", token: "ui-secret-token" },
            createdAt: "2026-07-03T08:30:00.000Z",
            updatedAt: "2026-07-03T08:30:00.000Z",
          },
        ],
      },
    });
    await expectApiOk(conflictingNodePinsResponse, "seed conflicting shared Studio node pin for UI audit");
    await nodePinsSharedCard.getByRole("button", { name: /^Carregar pins$/ }).click();
    const nodePinConflictsPanel = nodePinsSection.getByLabel("Conflitos de pins de nó");
    await expect(nodePinConflictsPanel).toBeVisible();
    await expect(nodePinConflictsPanel).toContainText("llm_step");
    await expect(nodePinConflictsPanel.getByText(/2 candidato/)).toBeVisible();
    await expect(nodePinConflictsPanel.getByRole("button", { name: /^Manter mais recente$/ })).toBeVisible();
    await expect(nodePinConflictsPanel.getByRole("button", { name: /^Manter este pin$/ })).toBeVisible();
    const nodePinReviewDownloadPromise = page.waitForEvent("download");
    await nodePinsSharedCard.getByRole("button", { name: /^Exportar revisão$/ }).click();
    const nodePinReviewDownload = await nodePinReviewDownloadPromise;
    expect(nodePinReviewDownload.suggestedFilename()).toMatch(
      /^studio-node-pin-conflicts-reference-interview-[a-f0-9]+\.afnodepin-conflicts\.json$/,
    );
    const nodePinReviewPath = await nodePinReviewDownload.path();
    expect(nodePinReviewPath).toBeTruthy();
    const nodePinReviewText = await fs.readFile(nodePinReviewPath, "utf8");
    const nodePinReview = JSON.parse(nodePinReviewText);
    expect(nodePinReview.format).toBe("agent-flow-builder.studio-node-pins-conflict-review.v1");
    expect(nodePinReview.conflictCount).toBeGreaterThanOrEqual(1);
    expect(nodePinReview.governance.excludesCandidates).toBe(true);
    expect(nodePinReview.governance.excludesRawPinInputOutput).toBe(true);
    expect(nodePinReviewText).not.toContain('"candidates"');
    expect(nodePinReviewText).not.toContain('"pins"');
    expect(nodePinReviewText).not.toContain('"input"');
    expect(nodePinReviewText).not.toContain('"output"');
    expect(nodePinReviewText).not.toContain("ui-secret-key");
    expect(nodePinReviewText).not.toContain("ui-secret-token");
    expect(nodePinReviewText).not.toContain("Versão compartilhada divergente");
    expect(nodePinReviewText).not.toContain("Alternativa compartilhada");
    const nodePinReviewFileChooserPromise = page.waitForEvent("filechooser");
    await nodePinsSharedCard.getByRole("button", { name: /^Comparar revisão$/ }).click();
    const nodePinReviewFileChooser = await nodePinReviewFileChooserPromise;
    const nodePinReviewDiffDownloadPromise = page.waitForEvent("download");
    await nodePinReviewFileChooser.setFiles(nodePinReviewPath);
    const nodePinReviewDiffDownload = await nodePinReviewDiffDownloadPromise;
    expect(nodePinReviewDiffDownload.suggestedFilename()).toMatch(
      /^studio-node-pin-conflicts-diff-reference-interview-[a-f0-9]+\.afnodepin-conflicts-diff\.json$/,
    );
    const nodePinReviewDiffPath = await nodePinReviewDiffDownload.path();
    expect(nodePinReviewDiffPath).toBeTruthy();
    const nodePinReviewDiffText = await fs.readFile(nodePinReviewDiffPath, "utf8");
    const nodePinReviewDiff = JSON.parse(nodePinReviewDiffText);
    expect(nodePinReviewDiff.format).toBe("agent-flow-builder.studio-node-pins-conflict-review-diff.v1");
    expect(nodePinReviewDiff.governance.excludesCandidates).toBe(true);
    expect(nodePinReviewDiff.governance.excludesRawPinInputOutput).toBe(true);
    expect(nodePinReviewDiffText).not.toContain('"candidates"');
    expect(nodePinReviewDiffText).not.toContain('"pins"');
    expect(nodePinReviewDiffText).not.toContain('"input"');
    expect(nodePinReviewDiffText).not.toContain('"output"');
    expect(nodePinReviewDiffText).not.toContain("ui-secret-key");
    expect(nodePinReviewDiffText).not.toContain("ui-secret-token");
    await nodePinConflictsPanel.getByRole("button", { name: /^Manter mais recente$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Conflito de pin resolvido");
    await expect(nodePinConflictsPanel).toBeHidden();
    const scenarioTemplates = page.getByLabel("Templates de cenário");
    await expect(scenarioTemplates).toContainText("Caminho feliz");
    await expect(scenarioTemplates).toContainText("Bloqueio de safety");
    await expect(scenarioTemplates).toContainText("Replay com pins");
    await expect(scenarioTemplates).toContainText("Contrato JSON");
    await scenarioTemplates.getByRole("button", { name: /^Aplicar template Caminho feliz$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Template "Caminho feliz" aplicado');
    await expect(page.getByLabel("Critério textual da saída")).toHaveValue("pergunta");
    await expect(page.getByLabel("Usar pins de nó como mock")).not.toBeChecked();
    await page.getByLabel("Usar pins de nó como mock").check();
    await expect(page.getByLabel("Usar pins de nó como mock")).toBeChecked();
    await page.getByLabel("Tokens +%").fill("12");
    await page.getByLabel("LLM nós alterados", { exact: true }).fill("0");
    await page.getByLabel("LLM diffs de output", { exact: true }).fill("0");
    await page.getByLabel("Critério textual da saída").fill("Pergunta gerada");
    const evaluatorLibrary = page.getByLabel("Biblioteca de evaluators");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Nome do evaluator reutilizável");
      await dialog.accept("Pergunta gerada evaluator");
    });
    await evaluatorLibrary.getByRole("button", { name: /^Salvar evaluator$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Evaluator "Pergunta gerada evaluator" salvo');
    await expect(page.getByLabel("Evaluator reutilizável")).toContainText("Pergunta gerada evaluator");
    const evaluatorDownloadPromise = page.waitForEvent("download");
    await evaluatorLibrary.getByRole("button", { name: /^Exportar evaluators$/ }).click();
    const evaluatorDownload = await evaluatorDownloadPromise;
    expect(evaluatorDownload.suggestedFilename()).toBe("studio-scenario-evaluators.afevaluators.json");
    const evaluatorDownloadPath = await evaluatorDownload.path();
    expect(evaluatorDownloadPath).toBeTruthy();
    const evaluatorFile = JSON.parse(await fs.readFile(evaluatorDownloadPath, "utf-8"));
    expect(evaluatorFile.format).toBe("agent-flow-builder.scenario-evaluators.v1");
    expect(evaluatorFile.evaluators[0].name).toBe("Pergunta gerada evaluator");
    expect(evaluatorFile.evaluators[0].expectedText).toBe("Pergunta gerada");
    await evaluatorLibrary.getByRole("button", { name: /^Remover evaluator$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Evaluator "Pergunta gerada evaluator" removido');
    await page.getByLabel("Importar biblioteca de evaluators").setInputFiles({
      name: "studio-scenario-evaluators.afevaluators.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(evaluatorFile), "utf-8"),
    });
    await expect(page.locator("footer[role='status']")).toContainText("Biblioteca de evaluators importada");
    await page.getByLabel("Evaluator reutilizável").selectOption({ label: "Pergunta gerada evaluator" });
    await expect(page.getByLabel("Critério textual da saída")).toHaveValue("Pergunta gerada");
    await page.getByLabel("Critério textual da saída").fill("gerada");
    await page.getByLabel("Operador do evaluator").selectOption("all");
    await evaluatorLibrary.getByRole("button", { name: /^Adicionar regra$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Regra adicionada ao evaluator "Pergunta gerada evaluator"');
    await expect(page.getByText(/2 regra\(s\).*todas precisam passar/)).toBeVisible();
    const compositeEvaluatorDownloadPromise = page.waitForEvent("download");
    await evaluatorLibrary.getByRole("button", { name: /^Exportar evaluators$/ }).click();
    const compositeEvaluatorDownload = await compositeEvaluatorDownloadPromise;
    const compositeEvaluatorPath = await compositeEvaluatorDownload.path();
    expect(compositeEvaluatorPath).toBeTruthy();
    const compositeEvaluatorFile = JSON.parse(await fs.readFile(compositeEvaluatorPath, "utf-8"));
    expect(compositeEvaluatorFile.evaluators[0].operator).toBe("all");
    expect(compositeEvaluatorFile.evaluators[0].rules).toHaveLength(2);
    await page.getByRole("button", { name: /^Criar fork$/ }).click();
    await expect(page.getByText("Fork criado a partir do evento #4.")).toBeVisible();
    const scenarioSection = page.locator(".sandbox-section", { hasText: "Cenários de teste" });
    const selectedScenarioCard = scenarioSection.locator("article.runtime-item", { hasText: "Fork de checkpoint" });
    await expect(selectedScenarioCard.getByText("Fork llm_step #4", { exact: true })).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Origem: reference-interview.*fork de checkpoint.*run-ui-audit-ok.*llm_step#4/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Fork de checkpoint: .*#4.*llm_step/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Restore: checkpointer -> snapshot/)).toBeVisible();
    await expect(selectedScenarioCard.locator(".checkpoint-compatibility").getByText(/compatibilidade: versão\/hash(\/projeto)? atuais/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Mock por pins de nó: 1 pin/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Evaluator: Pergunta gerada evaluator/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Critério textual: Todas as regras: Saída contém "Pergunta gerada".*Saída contém "gerada"/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Thresholds: tokens \+12%.*custo \+20%.*duração \+30%/)).toBeVisible();
    await expect(selectedScenarioCard.getByText(/Thresholds por tipo: 2 limite/)).toBeVisible();
    const scenarioReplayGuide = selectedScenarioCard.getByLabel("Roteiro guiado do cenário");
    await expect(scenarioReplayGuide).toContainText("Roteiro guiado do replay");
    await expect(scenarioReplayGuide).toContainText("Origem");
    await expect(scenarioReplayGuide).toContainText("Compatibilidade");
    await expect(scenarioReplayGuide).toContainText("Restore");
    await expect(scenarioReplayGuide).toContainText("Pins");
    await expect(scenarioReplayGuide).toContainText("Execução");
    await expect(scenarioReplayGuide.getByLabel("Próxima ação do replay")).toContainText("Executar replay");
    const guidedReplayExecution = scenarioReplayGuide.getByLabel("Execução guiada do replay");
    await expect(guidedReplayExecution).toContainText("Preparar fixture");
    await expect(guidedReplayExecution).toContainText("Restaurar checkpoint");
    await expect(guidedReplayExecution).toContainText("Aplicar pins");
    await expect(guidedReplayExecution).toContainText("Executar e observar");
    await expect(guidedReplayExecution).toContainText("Avaliar resultado");
    await expect(guidedReplayExecution).toContainText("mocks entram no metadata");
    const governedReplayComparison = scenarioReplayGuide.getByLabel("Comparação governada do replay");
    await expect(governedReplayComparison).toContainText("Comparação governada");
    await expect(governedReplayComparison).toContainText("Checkpoint vs flow");
    await expect(governedReplayComparison).toContainText("Pins vs grafo atual");
    await expect(governedReplayComparison).toContainText("Restore vs run carregado");
    await expect(governedReplayComparison).toContainText("Critério e thresholds");
    const replayGovernanceReview = governedReplayComparison.getByLabel("Curadoria governada do replay");
    await expect(replayGovernanceReview).toContainText("Curadoria");
    await expect(replayGovernanceReview).toContainText("revisor local-user");
    await expect(governedReplayComparison.getByRole("button", { name: /^Exportar histórico$/ })).toBeVisible();
    await governedReplayComparison.getByRole("button", { name: /^Salvar snapshot$/ }).click();
    await expect(governedReplayComparison).toContainText(/histórico [1-9]\d*/);
    await expect(governedReplayComparison.getByRole("button", { name: /^Exportar histórico$/ })).toBeEnabled();
    const [replayGovernanceHistoryDownload] = await Promise.all([
      page.waitForEvent("download"),
      governedReplayComparison.getByRole("button", { name: /^Exportar histórico$/ }).click(),
    ]);
    expect(replayGovernanceHistoryDownload.suggestedFilename()).toMatch(
      /^studio-replay-governance-history-reference-interview\.afreplayhistory\.json$/,
    );
    const replayGovernanceHistoryPath = await replayGovernanceHistoryDownload.path();
    expect(replayGovernanceHistoryPath).toBeTruthy();
    const replayGovernanceHistoryFile = JSON.parse(await fs.readFile(replayGovernanceHistoryPath, "utf-8"));
    expect(replayGovernanceHistoryFile.format).toBe("agent-flow-builder.replay-governance-history.v1");
    expect(replayGovernanceHistoryFile.snapshotCount).toBeGreaterThanOrEqual(1);
    const replayGovernanceHistorySnapshot = replayGovernanceHistoryFile.snapshots.find(
      (snapshot) => snapshot.scenario.sourceKind === "checkpoint_fork" && snapshot.scenario.sourceRunId === "run-ui-audit-ok",
    );
    expect(replayGovernanceHistorySnapshot).toBeTruthy();
    expect(replayGovernanceHistorySnapshot.scenario.label).toContain("Fork");
    expect(replayGovernanceHistorySnapshot.scenario.hasCheckpoint).toBe(true);
    expect(replayGovernanceHistorySnapshot.scenario.useNodePins).toBe(true);
    expect(replayGovernanceHistorySnapshot.comparison.items.map((item) => item.id)).toEqual([
      "checkpoint",
      "pins",
      "restore",
      "evaluation",
    ]);
    expect(replayGovernanceHistorySnapshot.evidence.activePinCount).toBe(1);
    expect(replayGovernanceHistorySnapshot.review.reviewer).toMatch(/local-user|central-reviewer/);
    expect(replayGovernanceHistorySnapshot.review.status).toMatch(/approved|needs_review|monitor/);
    expect(replayGovernanceHistorySnapshot.review.governance.excludesRawScenarioPayload).toBe(true);
    expect(replayGovernanceHistorySnapshot.review.governance.excludesRawPinPayloads).toBe(true);
    expect(replayGovernanceHistorySnapshot.review.governance.excludesRawCheckpointState).toBe(true);
    expect(replayGovernanceHistorySnapshot.review.governance.excludesSecretValues).toBe(true);
    for (const replaySnapshot of replayGovernanceHistoryFile.snapshots) {
      expect(replaySnapshot).not.toHaveProperty("input");
      expect(replaySnapshot).not.toHaveProperty("payload");
      expect(replaySnapshot.evidence).not.toHaveProperty("checkpointState");
    }
    expect(replayGovernanceHistoryFile.governance.excludesRawScenarioPayload).toBe(true);
    expect(replayGovernanceHistoryFile.governance.excludesRawPinPayloads).toBe(true);
    expect(replayGovernanceHistoryFile.governance.excludesRawCheckpointState).toBe(true);
    expect(replayGovernanceHistoryFile.governance.excludesSecretValues).toBe(true);
    const conflictingReplayGovernanceSnapshot = {
      ...replayGovernanceHistorySnapshot,
      id: `${replayGovernanceHistorySnapshot.id}-central-review`,
      capturedAt: "2026-07-04T12:00:00.000Z",
      snapshotHash: `${replayGovernanceHistorySnapshot.snapshotHash}-central`,
      packageHash: `${replayGovernanceHistorySnapshot.packageHash}-central`,
      review: {
        ...replayGovernanceHistorySnapshot.review,
        status: "needs_review",
        statusLabel: "precisa revisão",
        reviewer: "central-reviewer",
        reviewedAt: "2026-07-04T12:00:00.000Z",
        decision: "review_before_promotion",
        summary: "mesma evidência com curadoria divergente",
        reasons: ["curadoria central pediu revisão"],
        nextAction: "resolver conflito antes de promover",
      },
    };
    const replayConflictResponse = await page.request.post(
      `${apiUrl}/flows/reference-interview/replay-governance-history/merge`,
      {
        data: {
          format: "agent-flow-builder.replay-governance-history.v1",
          exportedAt: "2026-07-04T12:00:00.000Z",
          flowId: "reference-interview",
          snapshots: [conflictingReplayGovernanceSnapshot],
        },
      },
    );
    expect(replayConflictResponse.ok()).toBe(true);
    await governedReplayComparison.getByRole("button", { name: /^Salvar snapshot$/ }).click();
    await expect(governedReplayComparison).toContainText(/histórico ([2-9]|\d{2,})/);
    await expect(governedReplayComparison.getByLabel("Conflitos do histórico de replay")).toContainText("Conflitos de replay");
    await expect(governedReplayComparison.getByRole("button", { name: /^Exportar revisão$/ })).toBeEnabled();
    await expect(governedReplayComparison.getByRole("button", { name: /^Comparar revisão$/ })).toBeVisible();
    const [replayConflictReviewDownload] = await Promise.all([
      page.waitForEvent("download"),
      governedReplayComparison.getByRole("button", { name: /^Exportar revisão$/ }).click(),
    ]);
    expect(replayConflictReviewDownload.suggestedFilename()).toMatch(
      /^studio-replay-conflicts-reference-interview-[a-f0-9]+\.afreplay-conflicts\.json$/,
    );
    const replayConflictReviewPath = await replayConflictReviewDownload.path();
    expect(replayConflictReviewPath).toBeTruthy();
    const replayConflictReviewFile = JSON.parse(await fs.readFile(replayConflictReviewPath, "utf-8"));
    const replayConflictReviewText = JSON.stringify(replayConflictReviewFile);
    expect(replayConflictReviewFile.format).toBe("agent-flow-builder.replay-governance-history-conflict-review.v1");
    expect(replayConflictReviewFile.conflictCount).toBeGreaterThanOrEqual(1);
    expect(replayConflictReviewFile.governance.excludesSnapshots).toBe(true);
    expect(replayConflictReviewFile.governance.excludesRawScenarioPayload).toBe(true);
    expect(replayConflictReviewFile.governance.excludesRawPinPayloads).toBe(true);
    expect(replayConflictReviewFile.governance.excludesRawCheckpointState).toBe(true);
    expect(replayConflictReviewText).not.toContain('"snapshots"');
    expect(replayConflictReviewText).not.toContain('"evidence"');
    expect(replayConflictReviewText).not.toContain('"payload"');
    expect(replayConflictReviewText).not.toContain('"input"');
    expect(replayConflictReviewText).not.toContain('"output"');
    expect(replayConflictReviewText).not.toContain('"checkpoint"');
    expect(replayConflictReviewText).not.toContain('"state"');
    const replayConflictReviewFileChooserPromise = page.waitForEvent("filechooser");
    await governedReplayComparison.getByRole("button", { name: /^Comparar revisão$/ }).click();
    const replayConflictReviewFileChooser = await replayConflictReviewFileChooserPromise;
    const replayConflictReviewDiffDownloadPromise = page.waitForEvent("download");
    await replayConflictReviewFileChooser.setFiles(replayConflictReviewPath);
    const replayConflictReviewDiffDownload = await replayConflictReviewDiffDownloadPromise;
    expect(replayConflictReviewDiffDownload.suggestedFilename()).toMatch(
      /^studio-replay-conflicts-diff-reference-interview-[a-f0-9]+\.afreplay-conflicts-diff\.json$/,
    );
    const replayConflictReviewDiffPath = await replayConflictReviewDiffDownload.path();
    expect(replayConflictReviewDiffPath).toBeTruthy();
    const replayConflictReviewDiffFile = JSON.parse(await fs.readFile(replayConflictReviewDiffPath, "utf-8"));
    const replayConflictReviewDiffText = JSON.stringify(replayConflictReviewDiffFile);
    expect(replayConflictReviewDiffFile.format).toBe("agent-flow-builder.replay-governance-history-conflict-review-diff.v1");
    expect(replayConflictReviewDiffFile.governance.excludesSnapshots).toBe(true);
    expect(replayConflictReviewDiffFile.governance.excludesRawScenarioPayload).toBe(true);
    expect(replayConflictReviewDiffText).not.toContain('"snapshots"');
    expect(replayConflictReviewDiffText).not.toContain('"evidence"');
    expect(replayConflictReviewDiffText).not.toContain('"payload"');
    expect(replayConflictReviewDiffText).not.toContain('"input"');
    expect(replayConflictReviewDiffText).not.toContain('"output"');
    expect(replayConflictReviewDiffText).not.toContain('"checkpoint"');
    expect(replayConflictReviewDiffText).not.toContain('"state"');
    const replayGovernanceHistoryDiff = governedReplayComparison.getByLabel("Comparação histórica do replay");
    await expect(replayGovernanceHistoryDiff).toContainText("Comparação histórica");
    await expect(replayGovernanceHistoryDiff).toContainText("sem mudança");
    await expect(replayGovernanceHistoryDiff).toContainText("Checkpoint vs flow");
    await expect(replayGovernanceHistoryDiff.getByRole("button", { name: /^Exportar diff histórico$/ })).toBeEnabled();
    const [replayGovernanceHistoryDiffDownload] = await Promise.all([
      page.waitForEvent("download"),
      replayGovernanceHistoryDiff.getByRole("button", { name: /^Exportar diff histórico$/ }).click(),
    ]);
    expect(replayGovernanceHistoryDiffDownload.suggestedFilename()).toMatch(
      /^studio-replay-governance-history-diff-reference-interview-.*\.afreplayhistorydiff\.json$/,
    );
    const replayGovernanceHistoryDiffPath = await replayGovernanceHistoryDiffDownload.path();
    expect(replayGovernanceHistoryDiffPath).toBeTruthy();
    const replayGovernanceHistoryDiffFile = JSON.parse(await fs.readFile(replayGovernanceHistoryDiffPath, "utf-8"));
    expect(replayGovernanceHistoryDiffFile.format).toBe("agent-flow-builder.replay-governance-history-diff.v1");
    expect(replayGovernanceHistoryDiffFile.scenario.label).toContain("Fork");
    expect(replayGovernanceHistoryDiffFile.comparison.statusLabel).toBe("estável");
    expect(replayGovernanceHistoryDiffFile.comparison.previousSnapshot).toBeTruthy();
    expect(replayGovernanceHistoryDiffFile.comparison.latestSnapshot).toBeTruthy();
    expect(replayGovernanceHistoryDiffFile.comparison.latestSnapshot.reviewer).toMatch(/local-user|central-reviewer/);
    expect(replayGovernanceHistoryDiffFile.comparison.latestSnapshot.reviewStatus).toMatch(/approved|needs_review|monitor/);
    expect(replayGovernanceHistoryDiffFile.comparison.itemChanges.map((item) => item.change)).toEqual([
      "stable",
      "stable",
      "stable",
      "stable",
    ]);
    expect(replayGovernanceHistoryDiffFile).not.toHaveProperty("input");
    expect(replayGovernanceHistoryDiffFile).not.toHaveProperty("payload");
    expect(replayGovernanceHistoryDiffFile.governance.excludesRawScenarioPayload).toBe(true);
    expect(replayGovernanceHistoryDiffFile.governance.excludesRawPinPayloads).toBe(true);
    expect(replayGovernanceHistoryDiffFile.governance.excludesRawCheckpointState).toBe(true);
    expect(replayGovernanceHistoryDiffFile.governance.excludesSecretValues).toBe(true);
    const [replayGovernanceDownload] = await Promise.all([
      page.waitForEvent("download"),
      governedReplayComparison.getByRole("button", { name: /^Exportar governança$/ }).click(),
    ]);
    expect(replayGovernanceDownload.suggestedFilename()).toMatch(
      /^studio-replay-governance-reference-interview-.*\.afreplaygovernance\.json$/,
    );
    const replayGovernancePath = await replayGovernanceDownload.path();
    expect(replayGovernancePath).toBeTruthy();
    const replayGovernanceFile = JSON.parse(await fs.readFile(replayGovernancePath, "utf-8"));
    expect(replayGovernanceFile.format).toBe("agent-flow-builder.replay-governance.v1");
    expect(replayGovernanceFile.scenario.hasCheckpoint).toBe(true);
    expect(replayGovernanceFile.scenario.useNodePins).toBe(true);
    expect(replayGovernanceFile.comparison.items.map((item) => item.id)).toEqual([
      "checkpoint",
      "pins",
      "restore",
      "evaluation",
    ]);
    expect(replayGovernanceFile.evidence.pins.active[0]).not.toHaveProperty("input");
    expect(replayGovernanceFile.evidence.pins.active[0]).not.toHaveProperty("output");
    expect(replayGovernanceFile.governance.excludesRawScenarioPayload).toBe(true);
    expect(replayGovernanceFile.governance.excludesRawPinPayloads).toBe(true);
    expect(replayGovernanceFile.governance.excludesRawCheckpointState).toBe(true);
    await expect(scenarioReplayGuide.getByRole("button", { name: /^Focar origem$/ })).toBeEnabled();
    await expect(scenarioReplayGuide.getByRole("button", { name: /^Filtrar origem$/ })).toBeEnabled();
    await expect(scenarioReplayGuide.getByRole("button", { name: /^Executar replay$/ })).toBeEnabled();
    await expect(scenarioReplayGuide.getByRole("button", { name: /^Ativar pins$/ })).toBeDisabled();
    await expect(scenarioReplayGuide.getByRole("button", { name: /^Exportar fixture guiada$/ })).toBeEnabled();
    const scenarioSourcePanel = scenarioSection.getByLabel("Consolidação de cenários por origem");
    await expect(scenarioSourcePanel).toContainText("1/1 visível");
    await scenarioReplayGuide.getByRole("button", { name: /^Filtrar origem$/ }).click();
    await expect(page.getByLabel("Filtrar cenários por tipo de origem")).toHaveValue("checkpoint_fork");
    await expect(page.getByLabel("Filtrar cenários por agente")).toHaveValue("reference-interview");
    await expect(page.getByLabel("Filtrar cenários por run")).toHaveValue("run-ui-audit-ok");
    await expect(scenarioSourcePanel).toContainText("1/1 visível");
    await expect(scenarioSection.getByRole("button", { name: /^Executar filtrados$/ })).toBeEnabled();
    const datasetLibrary = page.getByLabel("Biblioteca de datasets");
    const datasetScenarioList = page.getByLabel("Cenários do dataset");
    await expect(datasetScenarioList).toContainText(/0\/1 marcado.*1 visível/);
    await datasetScenarioList.getByRole("button", { name: /^Selecionar filtrados$/ }).click();
    await expect(datasetScenarioList).toContainText("1/1 marcado");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Nome do dataset local");
      await dialog.accept("Pergunta dataset");
    });
    await datasetLibrary.getByRole("button", { name: /^Salvar dataset$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Dataset "Pergunta dataset" salvo');
    await expect(page.getByLabel("Dataset local")).toContainText("Pergunta dataset");
    const selectedDatasetCard = scenarioSection.locator(".runtime-item", { hasText: "Dataset: Pergunta dataset" });
    await expect(selectedDatasetCard.getByText("Dataset: Pergunta dataset", { exact: true })).toBeVisible();
    await expect(selectedDatasetCard.getByText(/1\/1 cenário/)).toBeVisible();
    const sharedScenarioStatus = page.getByLabel("Cenários compartilhados", { exact: true });
    const sharedScenarioLibrary = page.getByLabel("Biblioteca compartilhada de cenários");
    await expect(sharedScenarioStatus).toContainText("Cenários compartilhados ainda não carregados");
    await expect(sharedScenarioLibrary.getByRole("button", { name: /^Salvar compartilhado$/ })).toBeEnabled();
    await expect(sharedScenarioLibrary.getByRole("button", { name: /^Central$/ })).toBeEnabled();
    await sharedScenarioLibrary.getByRole("button", { name: /^Salvar compartilhado$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("cenário(s), 1 dataset(s), 1 evaluator(s) salvos");
    await expect(sharedScenarioStatus).toContainText("1 dataset(s)");
    await expect(sharedScenarioStatus).toContainText("1 evaluator(s)");
    await expect(sharedScenarioStatus).toContainText("agente(s)");
    const datasetDownloadPromise = page.waitForEvent("download");
    await datasetLibrary.getByRole("button", { name: /^Exportar dataset$/ }).click();
    const datasetDownload = await datasetDownloadPromise;
    expect(datasetDownload.suggestedFilename()).toBe("studio-dataset-pergunta-dataset.afdataset.json");
    const datasetDownloadPath = await datasetDownload.path();
    expect(datasetDownloadPath).toBeTruthy();
    const datasetFile = JSON.parse(await fs.readFile(datasetDownloadPath, "utf-8"));
    expect(datasetFile.format).toBe("agent-flow-builder.scenario-dataset.v1");
    expect(datasetFile.dataset.name).toBe("Pergunta dataset");
    expect(datasetFile.dataset.version).toBe(1);
    expect(datasetFile.dataset.runHistory).toEqual([]);
    datasetFile.dataset.lastRunAt = "2026-01-01T00:00:00.000Z";
    datasetFile.dataset.runHistory = [{
      id: "dataset-run-old-flow",
      runAt: "2026-01-01T00:00:00.000Z",
      datasetVersion: 1,
      flowVersion: "0.0.1",
      flowHash: "00000000",
      resultCount: 1,
      okCount: 1,
      errorCount: 0,
      passCount: 1,
      warnCount: 0,
      failCount: 0,
      severity: "pass",
      reportHash: "11111111",
    }];
    expect(datasetFile.scenarios).toHaveLength(1);
    expect(datasetFile.scenarios[0].label).toBe("Fork llm_step #4");
    expect(datasetFile.dataset.scenarioIds).toContain(datasetFile.scenarios[0].id);
    await datasetLibrary.getByRole("button", { name: /^Remover dataset$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Dataset "Pergunta dataset" removido');
    await page.getByLabel("Importar dataset de cenários").setInputFiles({
      name: "studio-dataset-pergunta-dataset.afdataset.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(datasetFile), "utf-8"),
    });
    await expect(page.locator("footer[role='status']")).toContainText('Dataset "Pergunta dataset" importado');
    await expect(page.getByLabel("Dataset local")).toContainText("Pergunta dataset");
    await expect(datasetLibrary.getByRole("button", { name: /^Executar dataset$/ })).toBeEnabled();
    await expect(selectedDatasetCard.getByText(/Flow do experimento: v0\.0\.1/)).toBeVisible();
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
    expect(fixture.scenario.sourceContext.kind).toBe("checkpoint_fork");
    expect(fixture.scenario.sourceContext.agentId).toBe("reference-interview");
    expect(fixture.scenario.sourceContext.primaryRunId).toBe("run-ui-audit-ok");
    expect(fixture.scenario.sourceContext.nodeId).toBe("llm_step");
    expect(fixture.metadata.scenario.sourceContext.primaryRunId).toBe("run-ui-audit-ok");
    expect(fixture.scenario.expectedOutputText).toBe("gerada");
    expect(fixture.scenario.evaluatorName).toBe("Pergunta gerada evaluator");
    expect(fixture.scenario.evaluatorOperator).toBe("all");
    expect(fixture.scenario.evaluatorRules).toHaveLength(2);
    expect(fixture.metadata.scenario.expectedOutputText).toBe("gerada");
    expect(fixture.metadata.scenario.evaluatorName).toBe("Pergunta gerada evaluator");
    expect(fixture.metadata.scenario.evaluatorRules).toHaveLength(2);
    expect(fixture.scenario.regressionThresholds.tokenGrowthPct).toBe(12);
    expect(fixture.scenario.regressionThresholds.nodeTypeThresholds.llm_prompt.maxChangedNodes).toBe(0);
    expect(fixture.scenario.regressionThresholds.nodeTypeThresholds.llm_prompt.maxOutputDiffs).toBe(0);
    expect(fixture.metadata.scenario.regressionThresholds.nodeTypeThresholds.llm_prompt.maxChangedNodes).toBe(0);
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
    await expect(page.getByLabel("Critério textual da saída")).toHaveValue("gerada");
    await expect(page.getByLabel("Tokens +%")).toHaveValue("12");
    await expect(page.getByLabel("LLM nós alterados", { exact: true })).toHaveValue("0");
    await expect(page.getByLabel("LLM diffs de output", { exact: true })).toHaveValue("0");
    await expect(nodePinsSection.getByText(/llm_prompt.*#4.*llm_completed/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Executar selecionado$/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Executar lote$/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Executar favorito$/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Repetir último$/ })).toBeDisabled();
    await page.getByRole("button", { name: /^Favoritar$/ }).click();
    await expect(page.getByRole("button", { name: /^Desfavoritar$/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Executar favorito$/ })).toBeEnabled();
    await expect(selectedScenarioCard).toContainText("favorito");
    await expect(page.getByRole("button", { name: /^Exportar relatório$/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Aprovar lote$/ })).toBeDisabled();
    await expect(page.locator(".turn-input")).toHaveValue("Aumentar conversões em onboarding.");
    await datasetScenarioList.getByRole("button", { name: /^Selecionar todos$/ }).click();
    await expect(datasetScenarioList).toContainText("2/2 marcado");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Nome do dataset local");
      await dialog.accept("Pergunta dataset");
    });
    await datasetLibrary.getByRole("button", { name: /^Salvar dataset$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Dataset "Pergunta dataset" salvo com 2 cenário(s)');
    await expect(selectedDatasetCard.getByText(/v2.*2\/2 cenário/)).toBeVisible();
    await datasetLibrary.getByRole("button", { name: /^Executar dataset$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Dataset "Pergunta dataset" concluído: 2/2 cenário(s) executado(s).');
    await expect(page.getByRole("button", { name: /^Repetir último$/ })).toBeEnabled();
    const batchLayerSummary = page.getByLabel("Resultado do lote de cenários").getByLabel("Resumo multi-camadas de debug");
    await expect(batchLayerSummary).toContainText("Execução em lote");
    await expect(batchLayerSummary).toContainText("Comparações");
    await expect(batchLayerSummary).toContainText("Pins em lote");
    await expect(batchLayerSummary).toContainText("Checkpoints em lote");
    await expect(batchLayerSummary).toContainText(/\d+ cenário\(s\), \d+ pendência\(s\), \d+ checkpoint\(s\)/);
    await expect(batchLayerSummary.getByRole("button", { name: /^Executar filtrados$/ })).toBeVisible();
    await expect(batchLayerSummary.getByRole("button", { name: /^Revisar pendências$/ })).toBeVisible();
    await expect(batchLayerSummary.getByRole("button", { name: /^Filtrar checkpoints$/ })).toBeVisible();
    await expect(batchLayerSummary.getByRole("button", { name: /^Executar checkpoints$/ })).toBeVisible();
    await expect(
      batchLayerSummary.getByRole("button", { name: /^Compartilhar resumo multi-camadas do lote$/ }),
    ).toBeVisible();
    await expect(batchLayerSummary.getByRole("button", { name: /^Central$/ })).toBeVisible();
    await expect(batchLayerSummary.getByRole("button", { name: /^Sync central$/ })).toBeVisible();
    await batchLayerSummary.getByRole("button", { name: /^Compartilhar resumo multi-camadas do lote$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText(/Camadas de debug compartilhadas: \d+ snapshot\(s\)/);
    await expect(batchLayerSummary).toContainText(/\d+ snapshot\(s\) compartilhado\(s\).*synced/);
    const [batchLayerDownload] = await Promise.all([
      page.waitForEvent("download"),
      batchLayerSummary.getByRole("button", { name: /^Exportar resumo multi-camadas do lote$/ }).click(),
    ]);
    expect(batchLayerDownload.suggestedFilename()).toMatch(/^studio-debug-layers-batch-reference-interview-.*\.afdebuglayers\.json$/);
    const batchLayerPath = await batchLayerDownload.path();
    expect(batchLayerPath).toBeTruthy();
    const batchLayerFile = JSON.parse(await fs.readFile(batchLayerPath, "utf-8"));
    expect(batchLayerFile.format).toBe("agent-flow-builder.debug-layer-summary.v1");
    expect(batchLayerFile.scope).toBe("scenario_batch");
    expect(batchLayerFile.summary.items).toHaveLength(6);
    expect(batchLayerFile.evidence.batch.resultCount).toBe(2);
    expect(batchLayerFile.evidence.pins.scenarioUseCount).toBeGreaterThanOrEqual(1);
    expect(batchLayerFile.governance.excludesSecretValues).toBe(true);
    await expect(selectedDatasetCard.getByText(/Último resumo: 2\/2 ok/)).toBeVisible();
    await expect(selectedDatasetCard.getByText(/Experimentos: 2 execução/)).toBeVisible();
    await expect(selectedDatasetCard.getByText(/Comparação anterior: ok 0 p\.p\..*flow mudou/)).toBeVisible();
    await datasetLibrary.getByRole("button", { name: /^Executar dataset$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Dataset "Pergunta dataset" concluído: 2/2 cenário(s) executado(s).');
    await expect(selectedDatasetCard.getByText(/Experimentos: 3 execução/)).toBeVisible();
    await expect(selectedDatasetCard.getByText(/Comparação anterior: ok 0 p\.p\..*flow igual/)).toBeVisible();
    const datasetExperimentPanel = selectedDatasetCard.getByLabel("Histórico experimental do dataset");
    await expect(datasetExperimentPanel.getByText("Experimentos do dataset", { exact: true })).toBeVisible();
    await expect(datasetExperimentPanel.getByText("OK médio")).toBeVisible();
    await expect(datasetExperimentPanel.getByText("Pass médio")).toBeVisible();
    await expect(datasetExperimentPanel.getByText("Drift de flow")).toBeVisible();
    await expect(datasetExperimentPanel.getByText(/Tendência: estável/)).toBeVisible();
    await expect(datasetExperimentPanel.getByText(/Melhor execução: 100% ok/)).toBeVisible();
    const datasetExperimentsDownloadPromise = page.waitForEvent("download");
    await datasetExperimentPanel.getByRole("button", { name: /^Exportar experimentos$/ }).click();
    const datasetExperimentsDownload = await datasetExperimentsDownloadPromise;
    expect(datasetExperimentsDownload.suggestedFilename()).toBe("studio-dataset-pergunta-dataset-experiments.afexperiments.json");
    const datasetExperimentsPath = await datasetExperimentsDownload.path();
    expect(datasetExperimentsPath).toBeTruthy();
    const datasetExperimentsFile = JSON.parse(await fs.readFile(datasetExperimentsPath, "utf-8"));
    expect(datasetExperimentsFile.format).toBe("agent-flow-builder.dataset-experiments.v1");
    expect(datasetExperimentsFile.dataset.name).toBe("Pergunta dataset");
    expect(datasetExperimentsFile.dataset.scenarioCount).toBe(2);
    expect(datasetExperimentsFile.runs).toHaveLength(3);
    expect(datasetExperimentsFile.runs[0].okRatePct).toBe(100);
    expect(datasetExperimentsFile.runs[0].passRatePct).toBe(100);
    expect(datasetExperimentsFile.runs[0].trend).toBe("stable");
    expect(datasetExperimentsFile.runs[0].flowChangedFromPrevious).toBe(false);
    expect(datasetExperimentsFile.summary.runCount).toBe(3);
    expect(datasetExperimentsFile.summary.averageOkRatePct).toBe(100);
    expect(datasetExperimentsFile.summary.averagePassRatePct).toBe(100);
    expect(datasetExperimentsFile.summary.flowChangedRunCount).toBe(1);
    expect(datasetExperimentsFile.summary.latestTrend).toBe("stable");
    const experimentDashboard = page.getByLabel("Dashboard de experimentos");
    await expect(experimentDashboard.getByText("Dashboard de experimentos", { exact: true })).toBeVisible();
    await expect(experimentDashboard.getByText("Datasets com runs")).toBeVisible();
    await expect(experimentDashboard.getByText("OK global")).toBeVisible();
    await expect(experimentDashboard.getByText(/Pergunta dataset.*3 run/)).toBeVisible();
    const experimentDashboardDownloadPromise = page.waitForEvent("download");
    await experimentDashboard.getByRole("button", { name: /^Exportar dashboard$/ }).click();
    const experimentDashboardDownload = await experimentDashboardDownloadPromise;
    expect(experimentDashboardDownload.suggestedFilename()).toBe("studio-experiment-dashboard-reference-interview.afexperiment-dashboard.json");
    const experimentDashboardPath = await experimentDashboardDownload.path();
    expect(experimentDashboardPath).toBeTruthy();
    const experimentDashboardFile = JSON.parse(await fs.readFile(experimentDashboardPath, "utf-8"));
    expect(experimentDashboardFile.format).toBe("agent-flow-builder.experiment-dashboard.v1");
    expect(experimentDashboardFile.flow.id).toBe("reference-interview");
    expect(experimentDashboardFile.summary.datasetCount).toBe(1);
    expect(experimentDashboardFile.summary.datasetWithRunsCount).toBe(1);
    expect(experimentDashboardFile.summary.runCount).toBe(3);
    expect(experimentDashboardFile.summary.averageOkRatePct).toBe(100);
    expect(experimentDashboardFile.summary.flowChangedRunCount).toBe(1);
    expect(experimentDashboardFile.datasets[0].name).toBe("Pergunta dataset");
    expect(experimentDashboardFile.datasets[0].latestTrend).toBe("stable");
    await experimentDashboard.getByRole("button", { name: /^Salvar snapshot$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Snapshot do dashboard salvo", { timeout: 10_000 });
    const experimentDashboardHistoryResponse = await request.get(`${apiUrl}/flows/reference-interview/experiment-dashboard-history`);
    await expectApiOk(experimentDashboardHistoryResponse, "load experiment dashboard history after UI snapshot");
    const experimentDashboardHistory = await experimentDashboardHistoryResponse.json();
    expect(experimentDashboardHistory.format).toBe("agent-flow-builder.experiment-dashboard-history.v1");
    expect(experimentDashboardHistory.snapshotCount).toBeGreaterThanOrEqual(1);
    expect(experimentDashboardHistory.snapshots[0].summary.runCount).toBe(3);
    expect(experimentDashboardHistory.snapshots[0].summary.averageOkRatePct).toBe(100);
    expect(["new", "stable"]).toContain(experimentDashboardHistory.analysis.latestTrend);
    expect(experimentDashboardHistory.analysis.bestSnapshotId).toBe(experimentDashboardHistory.snapshots[0].id);
    const experimentDashboardHistoryDownloadPromise = page.waitForEvent("download");
    await experimentDashboard.getByRole("button", { name: /^Exportar histórico$/ }).click();
    const experimentDashboardHistoryDownload = await experimentDashboardHistoryDownloadPromise;
    expect(experimentDashboardHistoryDownload.suggestedFilename()).toBe(
      "studio-experiment-dashboard-history-reference-interview.afexperiment-dashboard-history.json",
    );
    const experimentDashboardHistoryPath = await experimentDashboardHistoryDownload.path();
    expect(experimentDashboardHistoryPath).toBeTruthy();
    const experimentDashboardHistoryFile = JSON.parse(await fs.readFile(experimentDashboardHistoryPath, "utf-8"));
    expect(experimentDashboardHistoryFile.format).toBe("agent-flow-builder.experiment-dashboard-history.v1");
    expect(experimentDashboardHistoryFile.snapshotCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(experimentDashboardHistoryFile).includes("observedOutput")).toBe(false);
    const experimentDashboardHistoryDiffDownloadPromise = page.waitForEvent("download");
    await page
      .getByLabel("Comparar histórico governado de dashboard experimental")
      .setInputFiles(experimentDashboardHistoryPath);
    const experimentDashboardHistoryDiffDownload = await experimentDashboardHistoryDiffDownloadPromise;
    expect(experimentDashboardHistoryDiffDownload.suggestedFilename()).toMatch(
      /^studio-experiment-dashboard-history-diff-reference-interview-.*\.afexperiment-dashboard-history-diff\.json$/,
    );
    const experimentDashboardHistoryDiffPath = await experimentDashboardHistoryDiffDownload.path();
    expect(experimentDashboardHistoryDiffPath).toBeTruthy();
    const experimentDashboardHistoryDiffFile = JSON.parse(await fs.readFile(experimentDashboardHistoryDiffPath, "utf-8"));
    expect(experimentDashboardHistoryDiffFile.format).toBe("agent-flow-builder.experiment-dashboard-history-diff.v1");
    expect(experimentDashboardHistoryDiffFile.summary.unchangedCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(experimentDashboardHistoryDiffFile).includes("\"dashboard\"")).toBe(false);
    expect(JSON.stringify(experimentDashboardHistoryDiffFile).includes("\"datasets\"")).toBe(false);
    expect(JSON.stringify(experimentDashboardHistoryDiffFile).includes("observedOutput")).toBe(false);
    const dedicatedExperimentHistory = experimentDashboard.getByLabel("Dashboard histórico dedicado");
    await expect(dedicatedExperimentHistory).toContainText("Dashboard histórico dedicado");
    await expect(dedicatedExperimentHistory).toContainText("Tendência:");
    await expect(dedicatedExperimentHistory).toContainText("Melhor snapshot");
    await expect(dedicatedExperimentHistory).toContainText("Pior snapshot");
    await expect(experimentDashboard.getByLabel("Histórico de dashboard")).toContainText(/3 run/);
    const annotationQueue = page.getByLabel("Fila de anotação local");
    await expect(annotationQueue.getByText(/0 item\(ns\).*0 pendente/)).toBeVisible();
    await page.getByLabel("Resultado do lote de cenários").getByRole("button", { name: /^Revisar$/ }).first().click();
    await expect(page.locator("footer[role='status']")).toContainText("adicionado à fila de revisão");
    await expect(annotationQueue.getByText(/1 item\(ns\).*1 pendente/)).toBeVisible();
    await annotationQueue.getByRole("button", { name: /^Assumir pendentes$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("1 pendência(s) assumida(s) por local-user");
    await expect(annotationQueue.getByText(/Responsável: local-user/)).toBeVisible();
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Responsável pela revisão compartilhada");
      await dialog.accept("QA local");
    });
    await annotationQueue.getByRole("button", { name: /^Responsável$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Item atribuído para QA local");
    await expect(annotationQueue.getByText(/Responsável: QA local/)).toBeVisible();
    await annotationQueue.getByLabel("Filtrar fila por responsável").selectOption("QA local");
    await expect(annotationQueue.locator(".annotation-item strong", { hasText: /Fork llm_step #4/ })).toBeVisible();
    await annotationQueue.getByRole("button", { name: /^Aprovar visíveis$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("1 pendência(s) marcada(s) como aprovado");
    await annotationQueue.getByRole("button", { name: /^Sincronizar fila$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Fila de revisão sincronizada", { timeout: 10_000 });
    await expect(annotationQueue).toContainText("sincronizada");
    const sharedAnnotationResponse = await request.get(`${apiUrl}/flows/reference-interview/annotation-queue`);
    await expectApiOk(sharedAnnotationResponse, "load shared annotation queue after UI sync");
    const sharedAnnotationFile = await sharedAnnotationResponse.json();
    expect(sharedAnnotationFile.format).toBe("agent-flow-builder.annotation-queue.v1");
    expect(sharedAnnotationFile.itemCount).toBe(1);
    expect(sharedAnnotationFile.acceptedCount).toBe(1);
    expect(sharedAnnotationFile.items[0].status).toBe("accepted");
    expect(sharedAnnotationFile.items[0].assignee).toBe("QA local");
    await annotationQueue.getByRole("button", { name: /^Salvar snapshot$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Snapshot da fila de revisão salvo (1)");
    await expect(annotationQueue.getByText("Histórico da fila", { exact: true })).toBeVisible();
    await expect(annotationQueue.getByText(/1 snapshot\(s\) locais compactos/)).toBeVisible();
    const storedAnnotationHistory = await page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("agent-flow-builder.annotation-queue-history.reference-interview") || "null"),
    );
    expect(storedAnnotationHistory.format).toBe("agent-flow-builder.annotation-queue-history.v1");
    expect(storedAnnotationHistory.snapshotCount).toBe(1);
    expect(storedAnnotationHistory.snapshots[0].summary.itemCount).toBe(1);
    expect(storedAnnotationHistory.snapshots[0].summary.acceptedCount).toBe(1);
    expect(storedAnnotationHistory.snapshots[0].summary.pendingCount).toBe(0);
    expect(storedAnnotationHistory.snapshots[0].summary.assigneeCounts["QA local"]).toBe(1);
    expect(storedAnnotationHistory.snapshots[0].summary.reviewerCounts["local-user"]).toBe(1);
    expect(storedAnnotationHistory.snapshots[0].items).toBeUndefined();
    const annotationHistoryDownloadPromise = page.waitForEvent("download");
    await annotationQueue.getByRole("button", { name: /^Exportar histórico$/ }).click();
    const annotationHistoryDownload = await annotationHistoryDownloadPromise;
    expect(annotationHistoryDownload.suggestedFilename()).toBe(
      "studio-annotation-queue-history-reference-interview.afannotationhistory.json",
    );
    const annotationHistoryPath = await annotationHistoryDownload.path();
    expect(annotationHistoryPath).toBeTruthy();
    const annotationHistoryFile = JSON.parse(await fs.readFile(annotationHistoryPath, "utf-8"));
    expect(annotationHistoryFile.format).toBe("agent-flow-builder.annotation-queue-history.v1");
    expect(annotationHistoryFile.snapshotCount).toBe(1);
    expect(annotationHistoryFile.snapshots[0].summary.acceptedCount).toBe(1);
    expect(annotationHistoryFile.snapshots[0].summary.assigneeCounts["QA local"]).toBe(1);
    expect(annotationHistoryFile.snapshots[0].items).toBeUndefined();
    const annotationDownloadPromise = page.waitForEvent("download");
    await annotationQueue.getByRole("button", { name: /^Exportar fila$/ }).click();
    const annotationDownload = await annotationDownloadPromise;
    expect(annotationDownload.suggestedFilename()).toBe("studio-annotation-queue-reference-interview.afannotations.json");
    const annotationPath = await annotationDownload.path();
    expect(annotationPath).toBeTruthy();
    const annotationFile = JSON.parse(await fs.readFile(annotationPath, "utf-8"));
    expect(annotationFile.format).toBe("agent-flow-builder.annotation-queue.v1");
    expect(annotationFile.itemCount).toBe(1);
    expect(annotationFile.acceptedCount).toBe(1);
    expect(annotationFile.items[0].status).toBe("accepted");
    expect(annotationFile.items[0].assignee).toBe("QA local");
    expect(annotationFile.items[0].reviewedBy).toBe("local-user");
    expect(annotationFile.reviewedCount).toBe(1);
    expect(annotationFile.assigneeCounts["QA local"]).toBe(1);
    expect(annotationFile.auditCount).toBeGreaterThan(0);
    expect(annotationFile.auditEntries.some((entry) => entry.action === "item_status_changed")).toBe(true);
    expect(annotationFile.permissionPolicy.mode).toBe("open");
    expect(annotationFile.permissionPolicy.reviewers).toEqual([]);
    expect(annotationFile.items[0].scenarioLabel).toBe("Fork llm_step #4");
    expect(annotationFile.items[0].batchHash).toMatch(/^[a-f0-9]{8}$/);
    const originalAnnotationVerdict = annotationFile.items[0].verdict;
    annotationFile.items[0].status = "rejected";
    annotationFile.items[0].reviewedBy = "revisor externo";
    annotationFile.items[0].reviewedAt = "2099-01-01T00:00:00.000Z";
    annotationFile.items[0].verdict = "Veredito recebido divergente";
    annotationFile.items[0].observedOutput = "Saída recebida divergente";
    annotationFile.items[0].updatedAt = "2099-01-01T00:00:00.000Z";
    await page.getByLabel("Importar fila de anotação").setInputFiles({
      name: "studio-annotation-queue-reference-interview.afannotations.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(annotationFile), "utf-8"),
    });
    await expect(page.locator("footer[role='status']")).toContainText("Fila de anotação importada");
    await annotationQueue.getByLabel("Filtrar fila por status").selectOption("rejected");
    await expect(annotationQueue.getByText(/1 item.*1 reprovado/)).toBeVisible();
    await expect(annotationQueue.getByText(/Revisor: revisor externo/)).toBeVisible();
    await expect(annotationQueue.getByText("Veredito recebido divergente", { exact: true })).toBeVisible();
    await expect(annotationQueue.getByText(/1 conflito\(s\) aberto\(s\) na fila compartilhada/)).toBeVisible();
    await expect(annotationQueue.getByText(/Veredito: compartilhada .* recebida Veredito recebido divergente/)).toBeVisible();
    await expect(annotationQueue.getByRole("button", { name: /^Exportar revisão$/ })).toBeEnabled();
    await expect(annotationQueue.getByRole("button", { name: /^Comparar revisão$/ })).toBeVisible();
    await expect
      .poll(async () => {
        const response = await request.get(`${apiUrl}/flows/reference-interview/annotation-queue`);
        if (!response.ok()) {
          return -1;
        }
        const body = await response.json();
        return body.openConflictCount ?? 0;
      }, { message: "annotation conflict persisted before review export" })
      .toBe(1);
    const [annotationConflictReviewDownload] = await Promise.all([
      page.waitForEvent("download"),
      annotationQueue.getByRole("button", { name: /^Exportar revisão$/ }).click(),
    ]);
    expect(annotationConflictReviewDownload.suggestedFilename()).toMatch(
      /^studio-annotation-conflicts-reference-interview-[a-f0-9]+\.afannotation-conflicts\.json$/,
    );
    const annotationConflictReviewPath = await annotationConflictReviewDownload.path();
    expect(annotationConflictReviewPath).toBeTruthy();
    const annotationConflictReviewFile = JSON.parse(await fs.readFile(annotationConflictReviewPath, "utf-8"));
    const annotationConflictReviewText = JSON.stringify(annotationConflictReviewFile);
    expect(annotationConflictReviewFile.format).toBe("agent-flow-builder.annotation-queue-conflict-review.v1");
    expect(annotationConflictReviewFile.conflictCount).toBe(1);
    expect(annotationConflictReviewFile.governance.excludesQueueItems).toBe(true);
    expect(annotationConflictReviewFile.governance.excludesSnapshots).toBe(true);
    expect(annotationConflictReviewFile.governance.excludesObservedOutputs).toBe(true);
    expect(annotationConflictReviewText).not.toContain('"items"');
    expect(annotationConflictReviewText).not.toContain('"existingSnapshot"');
    expect(annotationConflictReviewText).not.toContain('"incomingSnapshot"');
    expect(annotationConflictReviewText).not.toContain("Veredito recebido divergente");
    expect(annotationConflictReviewText).not.toContain("Saída recebida divergente");
    const annotationConflictReviewChooserPromise = page.waitForEvent("filechooser");
    await annotationQueue.getByRole("button", { name: /^Comparar revisão$/ }).click();
    const annotationConflictReviewChooser = await annotationConflictReviewChooserPromise;
    const annotationConflictReviewDiffDownloadPromise = page.waitForEvent("download");
    await annotationConflictReviewChooser.setFiles(annotationConflictReviewPath);
    const annotationConflictReviewDiffDownload = await annotationConflictReviewDiffDownloadPromise;
    expect(annotationConflictReviewDiffDownload.suggestedFilename()).toMatch(
      /^studio-annotation-conflicts-diff-reference-interview-[a-f0-9]+\.afannotation-conflicts-diff\.json$/,
    );
    const annotationConflictReviewDiffPath = await annotationConflictReviewDiffDownload.path();
    expect(annotationConflictReviewDiffPath).toBeTruthy();
    const annotationConflictReviewDiffFile = JSON.parse(await fs.readFile(annotationConflictReviewDiffPath, "utf-8"));
    const annotationConflictReviewDiffText = JSON.stringify(annotationConflictReviewDiffFile);
    expect(annotationConflictReviewDiffFile.format).toBe("agent-flow-builder.annotation-queue-conflict-review-diff.v1");
    expect(annotationConflictReviewDiffFile.governance.excludesQueueItems).toBe(true);
    expect(annotationConflictReviewDiffFile.governance.excludesSnapshots).toBe(true);
    expect(annotationConflictReviewDiffFile.governance.excludesObservedOutputs).toBe(true);
    expect(annotationConflictReviewDiffText).not.toContain('"existingSnapshot"');
    expect(annotationConflictReviewDiffText).not.toContain('"incomingSnapshot"');
    expect(annotationConflictReviewDiffText).not.toContain("Veredito recebido divergente");
    expect(annotationConflictReviewDiffText).not.toContain("Saída recebida divergente");
    await annotationQueue.getByRole("button", { name: /^Usar anterior$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Conflito resolvido usando versão compartilhada");
    await expect(
      annotationQueue.locator("article", { hasText: "Fila de anotação local" }).getByText(/0 conflito\(s\) aberto/),
    ).toBeVisible();
    await annotationQueue.getByLabel("Filtrar fila por status").selectOption("accepted");
    await expect(annotationQueue.getByText(/1 item.*1 aprovado/)).toBeVisible();
    await expect(annotationQueue.getByText(originalAnnotationVerdict)).toBeVisible();
    const datasetV2DownloadPromise = page.waitForEvent("download");
    await datasetLibrary.getByRole("button", { name: /^Exportar dataset$/ }).click();
    const datasetV2Download = await datasetV2DownloadPromise;
    expect(datasetV2Download.suggestedFilename()).toBe("studio-dataset-pergunta-dataset.afdataset.json");
    const datasetV2DownloadPath = await datasetV2Download.path();
    expect(datasetV2DownloadPath).toBeTruthy();
    const datasetV2File = JSON.parse(await fs.readFile(datasetV2DownloadPath, "utf-8"));
    expect(datasetV2File.dataset.version).toBe(2);
    expect(datasetV2File.scenarios).toHaveLength(2);
    expect(datasetV2File.dataset.runHistory[0].resultCount).toBe(2);
    expect(datasetV2File.dataset.runHistory[0].okCount).toBe(2);
    expect(datasetV2File.dataset.runHistory[0].datasetVersion).toBe(2);
    expect(datasetV2File.dataset.runHistory[1].datasetVersion).toBe(2);
    expect(datasetV2File.dataset.runHistory[0].flowVersion).toBe("0.1.0");
    expect(datasetV2File.dataset.runHistory[0].flowHash).toMatch(/^[a-f0-9]{8}$/);
    expect(datasetV2File.dataset.runHistory[2].flowVersion).toBe("0.0.1");
    expect(datasetV2File.dataset.runHistory[0].reportHash).toMatch(/^[a-f0-9]{8}$/);

    await page.getByLabel("Critério de saída").selectOption("jsonPathExists");
    await page.getByLabel("Critério textual da saída").fill("questions[0].text");
    await page.getByLabel("Evaluator reutilizável").selectOption("");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Nome do evaluator reutilizável");
      await dialog.accept("JSON path evaluator");
    });
    await evaluatorLibrary.getByRole("button", { name: /^Salvar evaluator$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Evaluator "JSON path evaluator" salvo');
    const jsonEvaluatorDownloadPromise = page.waitForEvent("download");
    await evaluatorLibrary.getByRole("button", { name: /^Exportar evaluators$/ }).click();
    const jsonEvaluatorDownload = await jsonEvaluatorDownloadPromise;
    const jsonEvaluatorPath = await jsonEvaluatorDownload.path();
    expect(jsonEvaluatorPath).toBeTruthy();
    const jsonEvaluatorFile = JSON.parse(await fs.readFile(jsonEvaluatorPath, "utf-8"));
    const jsonEvaluator = jsonEvaluatorFile.evaluators.find((item) => item.name === "JSON path evaluator");
    expect(jsonEvaluator.rules[0].matchMode).toBe("jsonPathExists");
    expect(jsonEvaluator.rules[0].expectedText).toBe("questions[0].text");

    await page.getByLabel("Evaluator reutilizável").selectOption("");
    await page.getByLabel("Tipo do evaluator").selectOption("llm_judge");
    await page.getByLabel("Endpoint do evaluator externo").fill("http://127.0.0.1:4567/judge");
    await page.getByLabel("Path de aprovação do evaluator").fill("result.pass");
    await page.getByLabel("Path de justificativa do evaluator").fill("result.reason");
    await page.getByLabel("Path de score do evaluator").fill("result.score");
    await page.getByLabel("Path de veredito do evaluator").fill("result.verdict");
    await page.getByLabel("Score mínimo do evaluator").fill("0.8");
    await page.getByLabel("Rubrica do judge").fill("A saída precisa conter uma pergunta gerada e responder em JSON avaliável.");
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toContain("Nome do evaluator reutilizável");
      await dialog.accept("Judge externo");
    });
    await evaluatorLibrary.getByRole("button", { name: /^Salvar evaluator$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText('Evaluator "Judge externo" salvo');
    await expect(evaluatorLibrary.getByRole("button", { name: /^Adicionar regra$/ })).toBeDisabled();
    const externalEvaluatorDownloadPromise = page.waitForEvent("download");
    await evaluatorLibrary.getByRole("button", { name: /^Exportar evaluators$/ }).click();
    const externalEvaluatorDownload = await externalEvaluatorDownloadPromise;
    const externalEvaluatorPath = await externalEvaluatorDownload.path();
    expect(externalEvaluatorPath).toBeTruthy();
    const externalEvaluatorFile = JSON.parse(await fs.readFile(externalEvaluatorPath, "utf-8"));
    const externalEvaluator = externalEvaluatorFile.evaluators.find((item) => item.name === "Judge externo");
    expect(externalEvaluator.kind).toBe("llm_judge");
    expect(externalEvaluator.rules).toEqual([]);
    expect(externalEvaluator.external.endpointUrl).toBe("http://127.0.0.1:4567/judge");
    expect(externalEvaluator.external.passPath).toBe("result.pass");
    expect(externalEvaluator.external.minScore).toBe(0.8);
    await page.getByLabel("Campo extracted_content").fill("Conteúdo para avaliar o judge externo.");
    await page.getByLabel("Campo context.topic").fill("Onboarding B2B");
    await page.getByRole("button", { name: /^Salvar$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("Cenário salvo.");
    await page.getByRole("button", { name: /^Executar selecionado$/ }).click();
    await expect(page.locator("footer[role='status']")).toContainText("LLM-as-judge aprovou: score 0.94 judge-pass", {
      timeout: 15_000,
    });
    expect(externalEvaluatorRequests.length).toBeGreaterThan(0);

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
    await expect(page.locator("footer[role='alert']")).toContainText(/não pode restaurar checkpoint: hash local do flow mudou/);

    const sharedScenarioPackageResponse = await request.get(`${apiUrl}/flows/reference-interview/studio-scenarios`);
    await expectApiOk(sharedScenarioPackageResponse, "load shared Studio scenarios for conflict audit");
    const sharedScenarioPackage = await sharedScenarioPackageResponse.json();
    expect(sharedScenarioPackage.evaluators).toHaveLength(1);
    const conflictingScenarioPackage = {
      ...sharedScenarioPackage,
      scenarios: [
        {
          ...sharedScenarioPackage.scenarios[0],
          label: `Conflito visual ${theme}`,
          updatedAt: new Date().toISOString(),
        },
      ],
      datasets: [],
      evaluators: [
        {
          ...sharedScenarioPackage.evaluators[0],
          name: `Evaluator visual ${theme}`,
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    const conflictScenarioMergeResponse = await request.post(`${apiUrl}/flows/reference-interview/studio-scenarios/merge`, {
      data: conflictingScenarioPackage,
    });
    await expectApiOk(conflictScenarioMergeResponse, "merge conflicting shared Studio scenario");
    await sharedScenarioLibrary.getByRole("button", { name: /^Carregar compartilhados$/ }).click();
    const scenarioConflictPanel = page.getByLabel("Conflitos de cenários compartilhados");
    await expect(scenarioConflictPanel).toContainText("Cenário");
    await expect(scenarioConflictPanel).toContainText("Conflito visual");
    await expect(scenarioConflictPanel).toContainText("Evaluator");
    await expect(scenarioConflictPanel).toContainText("Evaluator visual");
    await expect(scenarioConflictPanel).toContainText("Diferenças compactas");
    await expect(scenarioConflictPanel).toContainText("Rótulo");
    await expect(scenarioConflictPanel).toContainText("Nome");
    await expect(sharedScenarioLibrary.getByRole("button", { name: /^Exportar revisão$/ })).toBeEnabled();
    const [scenarioConflictReviewDownload] = await Promise.all([
      page.waitForEvent("download"),
      sharedScenarioLibrary.getByRole("button", { name: /^Exportar revisão$/ }).click(),
    ]);
    expect(scenarioConflictReviewDownload.suggestedFilename()).toMatch(
      /^studio-scenario-conflicts-reference-interview-.*\.afscenario-conflicts\.json$/,
    );
    const scenarioConflictReviewPath = await scenarioConflictReviewDownload.path();
    expect(scenarioConflictReviewPath).toBeTruthy();
    const scenarioConflictReview = JSON.parse(await fs.readFile(scenarioConflictReviewPath, "utf-8"));
    expect(scenarioConflictReview.format).toBe("agent-flow-builder.studio-scenarios-conflict-review.v1");
    expect(scenarioConflictReview.conflictCount).toBeGreaterThanOrEqual(2);
    expect(scenarioConflictReview.summary.scenarioConflictCount).toBeGreaterThanOrEqual(1);
    expect(scenarioConflictReview.summary.evaluatorConflictCount).toBeGreaterThanOrEqual(1);
    expect(scenarioConflictReview.governance.excludesCandidates).toBe(true);
    expect(scenarioConflictReview.governance.excludesRawScenarioInputs).toBe(true);
    expect(scenarioConflictReview.governance.excludesRawScenarioPayloads).toBe(true);
    expect(scenarioConflictReview.conflicts[0]).not.toHaveProperty("candidates");
    expect(scenarioConflictReview.conflicts[0].candidateContentHashes.length).toBeGreaterThanOrEqual(2);
    const scenarioConflictReviewJson = JSON.stringify(scenarioConflictReview);
    expect(scenarioConflictReviewJson).not.toContain('"candidates"');
    expect(scenarioConflictReviewJson).not.toContain("Aumentar conversões em onboarding.");
    await expect(sharedScenarioLibrary.getByRole("button", { name: /^Comparar revisão$/ })).toBeEnabled();
    const [scenarioConflictReviewDiffDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.getByLabel("Comparar revisão governada de conflitos de cenários").setInputFiles(scenarioConflictReviewPath),
    ]);
    expect(scenarioConflictReviewDiffDownload.suggestedFilename()).toMatch(
      /^studio-scenario-conflicts-diff-reference-interview-.*\.afscenario-conflicts-diff\.json$/,
    );
    const scenarioConflictReviewDiffPath = await scenarioConflictReviewDiffDownload.path();
    expect(scenarioConflictReviewDiffPath).toBeTruthy();
    const scenarioConflictReviewDiff = JSON.parse(await fs.readFile(scenarioConflictReviewDiffPath, "utf-8"));
    expect(scenarioConflictReviewDiff.format).toBe("agent-flow-builder.studio-scenarios-conflict-review-diff.v1");
    expect(scenarioConflictReviewDiff.current.conflictCount).toBeGreaterThanOrEqual(2);
    expect(scenarioConflictReviewDiff.incoming.conflictCount).toBeGreaterThanOrEqual(2);
    expect(scenarioConflictReviewDiff.governance.excludesCandidates).toBe(true);
    expect(scenarioConflictReviewDiff.governance.excludesRawScenarioInputs).toBe(true);
    expect(scenarioConflictReviewDiff.governance.excludesRawScenarioPayloads).toBe(true);
    const scenarioConflictReviewDiffJson = JSON.stringify(scenarioConflictReviewDiff);
    expect(scenarioConflictReviewDiffJson).not.toContain('"candidates"');
    expect(scenarioConflictReviewDiffJson).not.toContain("Aumentar conversões em onboarding.");
    const scenarioCurationControls = page.getByLabel("Curadoria de cenários compartilhados");
    await scenarioCurationControls.getByLabel("Curador de cenários compartilhados").fill("qa-scenario-curator");
    await scenarioCurationControls.getByLabel("Papel do curador de cenários").selectOption("viewer");
    await expect(scenarioConflictPanel.getByRole("button", { name: /^Assumir$/ }).first()).toBeDisabled();
    await expect(scenarioConflictPanel.getByRole("button", { name: /^Manter este$/ }).first()).toBeDisabled();
    await expect(scenarioCurationControls).toContainText("Viewer pode inspecionar diferenças");
    await scenarioCurationControls.getByLabel("Papel do curador de cenários").selectOption("reviewer");
    await expect(scenarioCurationControls).toContainText("qa-scenario-curator pode assumir e resolver conflitos");
    await scenarioConflictPanel.getByRole("button", { name: /^Assumir$/ }).first().click();
    await expect(page.locator("footer[role='status']")).toContainText("assumidos");
    await expect(scenarioConflictPanel).toContainText("qa-scenario-curator");
    await scenarioConflictPanel.getByRole("button", { name: /^Manter este$/ }).first().click();
    await expect(page.locator("footer[role='status']")).toContainText("resolvidos");

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

    const busyStatus = page.locator("footer.statusbar");
    const observedState = await busyStatus.getAttribute("data-state", { timeout: 750 }).catch(() => null);
    if (observedState === "busy") {
      expect(await busyStatus.getAttribute("aria-busy").catch(() => null)).toBe("true");
    }

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
    const deliveryChecklist = page.getByLabel("Checklist de entrega final");
    await expect(deliveryChecklist).toContainText("Checklist de entrega");
    await expect(deliveryChecklist).toContainText("Aprovação embarcada");
    await expect(deliveryChecklist).toContainText("Ambiente local");
    await expect(deliveryChecklist).toContainText("Modelos locais");
    await expect(deliveryChecklist).toContainText("Próxima ação");
    await expect(deliveryChecklist.getByRole("button", { name: /^Preparar \.env$/ })).toBeVisible();
    const exportAudit = page.getByLabel("Auditoria de exportação do ZIP");
    await expect(exportAudit).toContainText("Auditoria do ZIP");
    await expect(exportAudit).toContainText("runtime-final");
    await expect(exportAudit).toContainText("fastapi-runtime");
    await expect(exportAudit).toContainText(".agent-flow/export-manifest.json");
    await expect(exportAudit).toContainText("Manifesto embarcado");
    await expect(exportAudit).toContainText("Secrets fora do ZIP");
    const runbook = page.getByLabel("Runbook fora do Builder");
    await expect(runbook).toContainText("Rodar runtime final fora do Builder");
    await expect(runbook).toContainText("docker compose build");
    await expect(runbook).toContainText("docker compose up -d");
    await expect(runbook).toContainText("curl http://127.0.0.1:8080/metadata");
    await expect(page.getByLabel("Rotas do pacote exportado")).toContainText("http://127.0.0.1:8080/sessions");
    await expect(page.getByText(/ZIP preliminar: finalize Ambiente local/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Baixar zip preliminar$/ })).toBeVisible();
    const reportDownloadPromise = page.waitForEvent("download");
    await deliveryChecklist.getByRole("button", { name: /^Baixar relatório$/ }).click();
    const reportDownload = await reportDownloadPromise;
    expect(reportDownload.suggestedFilename()).toMatch(/delivery-report\.json$/);
    const reportPath = await reportDownload.path();
    expect(reportPath).toBeTruthy();
    const deliveryReport = JSON.parse(await fs.readFile(reportPath, "utf-8"));
    expect(deliveryReport.format).toBe("agent-flow-builder.runtime-delivery-report.v1");
    expect(deliveryReport.approval.embedded).toBe(true);
    expect(deliveryReport.export.detachedFromBuilder).toBe(true);
    expect(deliveryReport.export.excludesBuilderHistory).toBe(true);
    expect(deliveryReport.export.includesEnvValues).toBe(false);
    expect(deliveryReport.docker.modelSetup.required).toBe(false);
    expect(deliveryReport.agents).toEqual([]);
    expect(deliveryReport.agentOperations).toHaveLength(1);
    expect(deliveryReport.agentOperations[0]).toMatchObject({
      agentId: "reference-interview",
      routePrefix: "",
      resourceName: "sessions",
      basePath: "/sessions",
      status: "pending",
      statusLabel: "pendente",
      jobsOperations: null,
      jobsOperationsLabels: {
        worker: "não verificado",
        retryConcurrency: "não verificado",
        retention: "não verificado",
        schedules: "não verificado",
      },
    });
    expect(deliveryReport.runbook.title).toBe("Rodar runtime final fora do Builder");
    expect(deliveryReport.artifact.requiredFiles.some((file) => file.path === "Dockerfile" && file.present)).toBe(true);
    await expect(page.getByText("inclui .agent-flow/export-manifest.json e exclui .env")).toBeVisible();
    const zipDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /^Baixar zip preliminar$/ }).click();
    const zipDownload = await zipDownloadPromise;
    expect(zipDownload.suggestedFilename()).toMatch(/\.zip$/);
    const zipPath = await zipDownload.path();
    expect(zipPath).toBeTruthy();
    const zipText = (await fs.readFile(zipPath)).toString("utf-8");
    expect(zipText).toContain(".agent-flow/export-manifest.json");
    expect(zipText).toContain('"format": "agent-flow-builder.generated-artifact-export.v1"');
    expect(zipText).toContain('"packageType": "runtime-final"');
    expect(zipText).toContain('"includesEnvValues": false');
    expect(zipText).toContain('"title": "Rodar runtime final fora do Builder"');
    expect(zipText).toContain('"command": "docker compose up -d"');
    await expect(page.getByText("Runtime URL")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Status$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Preparar \.env$/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Modelos$/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Build$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Up( CPU| GPU)?$/ })).toBeVisible();
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
  const deliveryChecklist = page.getByLabel("Checklist de entrega final");
  await expect(deliveryChecklist.getByRole("button", { name: /^Preparar \.env$/ })).toBeVisible();

  await deliveryChecklist.getByRole("button", { name: /^Preparar \.env$/ }).click();
  await expect(page.getByText(".env encontrado")).toBeVisible({ timeout: 10_000 });
  await expect(deliveryChecklist.getByRole("button", { name: /^Build$/ })).toBeVisible({ timeout: 10_000 });

  await deliveryChecklist.getByRole("button", { name: /^Build$/ }).click();
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
  await expect(deliveryChecklist.getByRole("button", { name: /^Up$/ })).toBeVisible({ timeout: 10_000 });

  await deliveryChecklist.getByRole("button", { name: /^Up$/ }).click();
  await expect(page.getByText("Container Docker final iniciado.").first()).toBeVisible({ timeout: 10_000 });
  await expect(upAlert.getByText("ok")).toBeVisible();

  await page.getByRole("button", { name: /^Inspecionar$/ }).click();
  await expect(page.locator(".docker-service-row", { hasText: "api" }).getByText("running")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Application startup complete.")).toBeVisible();
  await expect(deliveryChecklist.getByRole("button", { name: /^Smoke$/ })).toBeVisible({ timeout: 10_000 });

  await deliveryChecklist.getByRole("button", { name: /^Smoke$/ }).click();
  await expect(page.getByText(/Smoke test falhou/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("erro").first()).toBeVisible();
  await expect(smokeAlert.getByText("erro")).toBeVisible();
  await expect(deliveryChecklist).toContainText("Smoke test");
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
  await openInspectorTab(page, "Studio");
  const studioApprovalGate = page.getByLabel("Gate de aprovação do Studio");
  await expect(studioApprovalGate).toContainText("Aprovação: desatualizada");
  await expect(studioApprovalGate).toContainText("API Docker bloqueada: o flow mudou depois da aprovação.");
  await expect(studioApprovalGate.getByRole("button", { name: /^Gerar runtime final$/ })).toBeDisabled();
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
  await page.locator("label.flow-select select").selectOption("reference-interview");
  await expect(page.getByRole("button", { name: /Agente de Referência/ })).toBeVisible();
  await expect(page.locator(".canvas-node-chip").first()).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", theme);
}

async function openInspectorTab(page, tabName) {
  const tab = page.locator(".tabs button", { hasText: tabName });
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(tab).toHaveClass(/active/);
}

function labeledSelect(root, labelText) {
  return root.getByRole("combobox", { name: labelText, exact: true });
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
              output: {
                assistant_message: {
                  code: "QUESTION",
                  text: "Pergunta gerada",
                },
              },
              execution_log: {
                mode: "mcp",
                status: "custom_code_executed",
                duration_ms: 42,
                target: "generate_questions",
                sandbox_isolation: "subprocess_stdio",
                sandbox_boundary: "process",
                sandbox_executor: "python",
                sandbox_transport: "jsonrpc_stdio",
                attempts: 1,
                input_path: "assistant_message.text",
              },
              sandbox: {
                isolation: "subprocess_stdio",
                boundary: "process",
                executor: "python",
                transport: "jsonrpc_stdio",
                cwd: "app/code",
              },
            },
            spans: [
              { name: "prompt_render", status: "ok", durationMs: 12 },
              { name: "llm_call", status: "ok", durationMs: 800, tokens: 168, costUsd: 0.0024 },
            ],
          },
        },
        {
          seq: 5,
          event_type: "node_completed",
          node: "output_safety_check",
          payload: { turn: 1, status: "ok", phase: "safety", safety: { blocked: false, decision: "allow" } },
        },
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
    {
      runtimeUrl: "http://127.0.0.1:8090",
      resourceName: "sessions",
      session: {
        session_id: "ui-audit-sandbox-error",
        status: "error",
        phase: "custom_code",
        turn: 1,
        max_turns: 3,
        metadata: { source: "ui-theme-audit", agent_id: "reference-interview", scenario: "sandbox-error" },
        is_complete: true,
      },
      transcript: [
        { seq: 1, role: "assistant", code: "QUESTION", content: "Qual conteúdo devemos avaliar?", metadata: {} },
        { seq: 2, role: "user", content: "Conteúdo para executor customizado.", metadata: {} },
      ],
      events: [
        { seq: 1, event_type: "session_started", node: "start", payload: { turn: 0, status: "running", phase: "created" } },
        {
          seq: 2,
          event_type: "custom_code_failed",
          node: "deterministic_gate",
          payload: {
            turn: 1,
            status: "custom_code_failed",
            phase: "custom_code",
            custom: {
              ok: false,
              status: "custom_code_failed",
              error: "Entry point não encontrado ou não chamável: generate_questions",
              execution_log: {
                mode: "file",
                status: "custom_code_failed",
                duration_ms: 15,
                target: "code/generate_questions.py",
                sandbox_isolation: "dedicated_process",
                sandbox_boundary: "process_workspace",
                sandbox_executor: "python",
                sandbox_transport: "stdin_stdout_json",
                attempts: 1,
                retry_attempts: 0,
                input_path: "assistant_message.text",
                error: "Entry point não encontrado ou não chamável: generate_questions",
              },
              sandbox: {
                isolation: "dedicated_process",
                boundary: "process_workspace",
                executor: "python",
                transport: "stdin_stdout_json",
                workspace: "temporary_copy",
                cleanup: "after_execution",
              },
            },
          },
        },
      ],
      logs: ["custom code failed", "dedicated process returned error"],
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

async function installStudioRuntimeStreamMocks(page) {
  const runtimeUrl = "http://127.0.0.1:19090";
  let sandboxRunning = false;
  let transcript = [];
  let events = [];
  let session = {
    session_id: "stream-session",
    agent_id: "reference-interview",
    status: "created",
    phase: "created",
    turn: 0,
    max_turns: 3,
    metadata: { source: "ui-theme-audit", agent_id: "reference-interview" },
    is_complete: false,
  };
  let runtimeJobs = [];
  let runtimeSchedules = [];

  const sandboxStatus = () => ({
    flowId: "reference-interview",
    running: sandboxRunning,
    port: sandboxRunning ? 19090 : null,
    pid: sandboxRunning ? 19090 : null,
    url: sandboxRunning ? runtimeUrl : null,
    docsUrl: sandboxRunning ? `${runtimeUrl}/docs` : null,
    runtimeDir: "generated/reference-interview-runtime",
    logs: sandboxRunning ? ["ui audit sandbox running", "turn stream ready"] : [],
  });

  const emptyJobMetrics = {
    total: 0,
    by_status: {},
    by_kind: {},
    attempts_total: 0,
    pending_due: 0,
    failed: 0,
    exhausted: 0,
    succeeded: 0,
    terminal: 0,
    success_rate: null,
    duration_ms_avg: null,
    duration_ms_min: null,
    duration_ms_max: null,
    duration_ms_p95: null,
    window_hours: 1,
    finished_in_window: 0,
    succeeded_in_window: 0,
    failed_in_window: 0,
    success_rate_in_window: null,
    window_duration_ms_avg: null,
    window_duration_ms_p95: null,
    throughput_per_hour: null,
    oldest_pending_at: null,
    next_due_at: null,
    finished_last_hour: 0,
    last_finished_at: null,
  };
  const runtimeJobMetrics = () => ({
    ...emptyJobMetrics,
    total: runtimeJobs.length,
    by_status: runtimeJobs.reduce((acc, job) => ({ ...acc, [job.status]: (acc[job.status] ?? 0) + 1 }), {}),
    by_kind: runtimeJobs.reduce((acc, job) => ({ ...acc, [job.kind]: (acc[job.kind] ?? 0) + 1 }), {}),
    pending_due: runtimeJobs.filter((job) => job.status === "pending" && !job.next_run_at).length,
    next_due_at: runtimeJobs.find((job) => job.next_run_at)?.next_run_at ?? null,
  });

  await page.route(`${apiUrl}/flows/reference-interview/generate`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        flowId: "reference-interview",
        flowPath: "flows/reference-interview/agent.flow.json",
        outDir: "generated/reference-interview-runtime",
      }),
    });
  });

  await page.route(`${apiUrl}/sandboxes/reference-interview/status`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sandboxStatus()) });
  });

  await page.route(`${apiUrl}/sandboxes`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sandboxes: sandboxRunning ? [sandboxStatus()] : [] }),
    });
  });

  await page.route(`${apiUrl}/sandboxes/reference-interview/start`, async (route) => {
    sandboxRunning = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sandboxStatus()) });
  });

  await page.route(`${runtimeUrl}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === "GET" && url.pathname === "/metadata") {
      await fulfillJson(route, {
        service: "reference-interview-runtime",
        runtime: "langgraph-fastapi-python",
        contract: "sessions-v1",
        flow_id: "reference-interview",
        agent_id: "reference-interview",
        flow_version: "0.1.0",
        llm_adapter: "openai",
        supports_multi_agent_bundle: false,
        operations: {
          jobs: {
            enabled: true,
            manual_cleanup_endpoint: "POST /jobs/cleanup",
            worker: {
              command: "python -m app.worker",
              interval_seconds: 5,
              limit: 20,
              retry_delay_seconds: 5,
              lease_seconds: 60,
              multiworker_claims: true,
            },
            retention: {
              automatic_cleanup_enabled: false,
              older_than_hours: 168,
              limit: 100,
              statuses: ["succeeded", "failed"],
              dry_run_default: true,
              terminal_statuses: ["failed", "succeeded"],
            },
            schedules: {
              interval: true,
              cron: "basic",
              event: true,
            },
          },
        },
      });
      return;
    }

    if (method === "POST" && url.pathname === "/sessions") {
      session = { ...session, status: "created", phase: "created", turn: 0, is_complete: false };
      transcript = [];
      events = [];
      runtimeJobs = [];
      runtimeSchedules = [];
      await fulfillJson(route, { session });
      return;
    }

    if (method === "POST" && url.pathname === `/sessions/${session.session_id}/start`) {
      session = { ...session, status: "active", phase: "awaiting_turn", turn: 0, is_complete: false };
      transcript = [
        { seq: 1, role: "assistant", code: "QUESTION", content: "Qual conteúdo devemos avaliar?", metadata: {} },
      ];
      events = [
        {
          seq: 1,
          agent_id: "reference-interview",
          event_type: "session_started",
          node: "start",
          payload: { turn: 0, status: "active", phase: "awaiting_turn" },
        },
      ];
      await fulfillJson(route, { session, messages: transcript });
      return;
    }

    if (method === "POST" && url.pathname === `/sessions/${session.session_id}/turn/stream`) {
      const idempotencyKey = request.headers()["idempotency-key"] ?? "";
      const assistantText = idempotencyKey === "ui-audit-turn-key"
        ? "Resposta incremental finalizada com chave controlada."
        : "Resposta incremental finalizada.";
      session = { ...session, status: "completed", phase: "completed", turn: 1, is_complete: true };
      transcript = [
        ...transcript,
        { seq: 2, role: "user", content: "Mensagem guiada pelo schema.", metadata: {} },
        { seq: 3, role: "assistant", code: "DONE", content: assistantText, metadata: {} },
      ];
      events = [
        ...events,
        {
          seq: 2,
          agent_id: "reference-interview",
          event_type: "node_completed",
          node: "input_safety_check",
          payload: { turn: 1, status: "ok", phase: "safety", safety: { blocked: false } },
        },
        {
          seq: 3,
          agent_id: "reference-interview",
          event_type: "llm_completed",
          node: "llm_step",
          payload: {
            turn: 1,
            status: "ok",
            phase: "generation",
            custom: { output: { assistant_message: { code: "DONE", text: assistantText } } },
          },
        },
      ];
      runtimeJobs = [
        {
          job_id: "job-ui-schedule",
          agent_id: "reference-interview",
          session_id: session.session_id,
          kind: "post_finish_summary",
          status: "pending",
          attempts: 0,
          max_attempts: 3,
          payload: { source: "ui-theme-audit" },
          result: {},
          last_error: {},
          next_run_at: null,
        },
      ];
      runtimeSchedules = [];
      const completed = {
        session,
        assistant_message: { code: "DONE", text: assistantText },
        safety: { blocked: false },
        can_finish: true,
      };
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "cache-control": "no-cache" },
        body: [
          `event: turn_started\ndata: ${JSON.stringify({ session_id: session.session_id })}\n\n`,
          `event: token\ndata: ${JSON.stringify({ index: 1, text: "Resposta incremental ", source: "llm_callback" })}\n\n`,
          `event: token\ndata: ${JSON.stringify({ index: 2, text: assistantText.replace("Resposta incremental ", ""), source: "llm_callback" })}\n\n`,
          `event: turn_completed\ndata: ${JSON.stringify(completed)}\n\n`,
          `event: stream_closed\ndata: ${JSON.stringify({ reason: "turn_completed", session_id: session.session_id, sent: 2 })}\n\n`,
        ].join(""),
      });
      return;
    }

    if (method === "POST" && url.pathname === `/sessions/${session.session_id}/turn`) {
      const payload = request.postDataJSON();
      const userMessage = typeof payload.user_message === "string" ? payload.user_message : "Mensagem guiada pelo dataset.";
      const assistantText = `Pergunta gerada para: ${userMessage}`;
      session = { ...session, status: "completed", phase: "completed", turn: 1, is_complete: true };
      transcript = [
        { seq: 1, role: "assistant", code: "QUESTION", content: "Qual conteúdo devemos avaliar?", metadata: {} },
        { seq: 2, role: "user", content: userMessage, metadata: {} },
        { seq: 3, role: "assistant", code: "DONE", content: assistantText, metadata: {} },
      ];
      events = [
        {
          seq: 1,
          agent_id: "reference-interview",
          event_type: "session_started",
          node: "start",
          payload: { turn: 0, status: "active", phase: "awaiting_turn" },
        },
        {
          seq: 2,
          agent_id: "reference-interview",
          event_type: "node_completed",
          node: "input_safety_check",
          payload: { turn: 1, status: "ok", phase: "safety", safety: { blocked: false } },
        },
        {
          seq: 3,
          agent_id: "reference-interview",
          event_type: "llm_completed",
          node: "llm_step",
          payload: {
            turn: 1,
            status: "ok",
            phase: "generation",
            llm: { usage: { total_tokens: 128 }, cost: 0.0012 },
            custom: { output: { assistant_message: { code: "DONE", text: assistantText } } },
          },
        },
      ];
      await fulfillJson(route, {
        session,
        assistant_message: { code: "DONE", text: assistantText },
        safety: { blocked: false },
        can_finish: true,
      });
      return;
    }

    if (method === "GET" && url.pathname === `/sessions/${session.session_id}/events/stream`) {
      expect(url.searchParams.get("api_key")).toBe("ui-runtime-audit-key");
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "cache-control": "no-cache" },
        body: `event: stream_closed\ndata: ${JSON.stringify({ reason: "ui_audit_idle", session_id: session.session_id, sent: 0 })}\n\n`,
      });
      return;
    }

    if (method === "GET" && url.pathname === `/sessions/${session.session_id}/transcript`) {
      await fulfillJson(route, transcript);
      return;
    }

    if (method === "GET" && url.pathname === `/sessions/${session.session_id}/events`) {
      await fulfillJson(route, events);
      return;
    }

    if (method === "GET" && url.pathname === "/jobs") {
      await fulfillJson(route, runtimeJobs);
      return;
    }

    if (method === "GET" && url.pathname === "/job-schedules") {
      const sessionId = url.searchParams.get("session_id");
      const status = url.searchParams.get("status");
      await fulfillJson(
        route,
        runtimeSchedules.filter(
          (schedule) =>
            (!sessionId || schedule.session_id === sessionId) &&
            (!status || schedule.status === status),
        ),
      );
      return;
    }

    if (method === "GET" && url.pathname === "/jobs/metrics") {
      expect(url.searchParams.get("window_hours")).toBe("1");
      await fulfillJson(route, runtimeJobMetrics());
      return;
    }

    if (method === "POST" && url.pathname === "/jobs/cleanup") {
      const payload = request.postDataJSON();
      expect(payload.session_id).toBe(session.session_id);
      expect(payload.older_than_hours).toBe(168);
      expect(payload.statuses).toEqual(["succeeded", "failed"]);
      await fulfillJson(route, {
        dry_run: payload.dry_run !== false,
        matched: 1,
        deleted: payload.dry_run === false ? 1 : 0,
        statuses: ["failed", "succeeded"],
        older_than_hours: 168,
        cutoff: "2026-06-25T15:00:00+00:00",
        job_ids: ["job-ui-cleanup-old"],
        by_status: { succeeded: 1 },
      });
      return;
    }

    if (method === "POST" && url.pathname === "/jobs/job-ui-schedule/schedule") {
      const payload = request.postDataJSON();
      expect(payload.delay_seconds).toBe(600);
      runtimeJobs = runtimeJobs.map((job) =>
        job.job_id === "job-ui-schedule"
          ? { ...job, next_run_at: "2026-07-02T15:10:00+00:00" }
          : job,
      );
      events = [
        ...events,
        {
          seq: 4,
          agent_id: "reference-interview",
          event_type: "post_finish_scheduled",
          node: null,
          payload: { job_id: "job-ui-schedule", next_run_at: "2026-07-02T15:10:00+00:00" },
        },
      ];
      await fulfillJson(route, { job: runtimeJobs[0] });
      return;
    }

    if (method === "POST" && url.pathname === "/jobs/job-ui-schedule/recurrence") {
      const payload = request.postDataJSON();
      if (payload.trigger_type === "cron") {
        expect(payload.cron_expression).toBe("0 9 * * *");
        const cronSchedule = {
          schedule_id: "schedule-ui-cron",
          agent_id: "reference-interview",
          session_id: session.session_id,
          kind: "post_finish_summary",
          status: "enabled",
          trigger_type: "cron",
          interval_seconds: 3600,
          cron_expression: "0 9 * * *",
          event_type: null,
          max_attempts: 3,
          payload: {
            source: "ui-theme-audit",
            recurrence: {
              source: "job_recurrence",
              source_job_id: "job-ui-schedule",
              trigger_type: "cron",
              interval_seconds: 3600,
              cron_expression: "0 9 * * *",
              event_type: null,
            },
          },
          last_job_id: null,
          last_run_at: null,
          next_run_at: "2026-07-03T09:00:00+00:00",
        };
        runtimeSchedules = [...runtimeSchedules.filter((item) => item.schedule_id !== cronSchedule.schedule_id), cronSchedule];
        await fulfillJson(route, { schedule: cronSchedule });
        return;
      }
      if (payload.trigger_type === "event") {
        expect(payload.event_type).toBe("session.finished");
        const eventSchedule = {
          schedule_id: "schedule-ui-event",
          agent_id: "reference-interview",
          session_id: session.session_id,
          kind: "post_finish_summary",
          status: "enabled",
          trigger_type: "event",
          interval_seconds: 3600,
          cron_expression: "session.finished",
          event_type: "session.finished",
          max_attempts: 3,
          payload: {
            source: "ui-theme-audit",
            recurrence: {
              source: "job_recurrence",
              source_job_id: "job-ui-schedule",
              trigger_type: "event",
              interval_seconds: 3600,
              cron_expression: null,
              event_type: "session.finished",
            },
          },
          last_job_id: null,
          last_run_at: null,
          next_run_at: null,
        };
        runtimeSchedules = [...runtimeSchedules.filter((item) => item.schedule_id !== eventSchedule.schedule_id), eventSchedule];
        await fulfillJson(route, { schedule: eventSchedule });
        return;
      }
      expect(payload.interval_seconds).toBe(3600);
      runtimeSchedules = [
        {
          schedule_id: "schedule-ui-hour",
          agent_id: "reference-interview",
          session_id: session.session_id,
          kind: "post_finish_summary",
          status: "enabled",
          trigger_type: "interval",
          interval_seconds: 3600,
          cron_expression: null,
          event_type: null,
          max_attempts: 3,
          payload: {
            source: "ui-theme-audit",
            recurrence: {
              source: "job_recurrence",
              source_job_id: "job-ui-schedule",
              trigger_type: "interval",
              interval_seconds: 3600,
              cron_expression: null,
              event_type: null,
            },
          },
          last_job_id: null,
          last_run_at: null,
          next_run_at: "2026-07-02T15:00:00+00:00",
        },
      ];
      await fulfillJson(route, { schedule: runtimeSchedules[0] });
      return;
    }

    if (method === "POST" && url.pathname === "/job-schedules/trigger-event") {
      const payload = request.postDataJSON();
      expect(payload.event_type).toBe("session.finished");
      expect(payload.session_id).toBe(session.session_id);
      const scheduledJob = {
        job_id: "job-ui-event-1",
        agent_id: "reference-interview",
        session_id: session.session_id,
        kind: "post_finish_summary",
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        payload: {
          source: "job_event",
          schedule_id: "schedule-ui-event",
          schedule_trigger_type: "event",
          schedule_event_type: "session.finished",
          event_payload: { source: "studio", session_id: session.session_id },
        },
        result: {},
        last_error: {},
        next_run_at: null,
      };
      runtimeJobs = [...runtimeJobs, scheduledJob];
      runtimeSchedules = runtimeSchedules.map((schedule) =>
        schedule.schedule_id === "schedule-ui-event"
          ? {
              ...schedule,
              last_job_id: scheduledJob.job_id,
              last_run_at: "2026-07-02T15:05:00+00:00",
              next_run_at: null,
            }
          : schedule,
      );
      await fulfillJson(route, {
        schedules: runtimeSchedules.filter((schedule) => schedule.schedule_id === "schedule-ui-event"),
        jobs: [scheduledJob],
        total: 1,
        enqueued: 1,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/job-schedules/run-due") {
      const scheduledJob = {
        job_id: "job-ui-recurring-1",
        agent_id: "reference-interview",
        session_id: session.session_id,
        kind: "post_finish_summary",
        status: "pending",
        attempts: 0,
        max_attempts: 3,
        payload: {
          source: "job_schedule",
          schedule_id: "schedule-ui-hour",
          schedule_trigger_type: "interval",
          schedule_interval_seconds: 3600,
          schedule_cron_expression: null,
        },
        result: {},
        last_error: {},
        next_run_at: null,
      };
      runtimeJobs = [...runtimeJobs, scheduledJob];
      runtimeSchedules = runtimeSchedules.map((schedule) =>
        schedule.schedule_id === "schedule-ui-hour"
          ? {
              ...schedule,
              last_job_id: scheduledJob.job_id,
              last_run_at: "2026-07-02T15:00:00+00:00",
              next_run_at: "2026-07-02T16:00:00+00:00",
            }
          : schedule,
      );
      await fulfillJson(route, {
        schedules: runtimeSchedules.filter((schedule) => schedule.schedule_id === "schedule-ui-hour"),
        jobs: [scheduledJob],
        total: 1,
        enqueued: 1,
      });
      return;
    }

    if (method === "POST" && url.pathname === "/job-schedules/schedule-ui-hour/disable") {
      runtimeSchedules = runtimeSchedules.map((schedule) =>
        schedule.schedule_id === "schedule-ui-hour" ? { ...schedule, status: "disabled" } : schedule,
      );
      await fulfillJson(route, { schedule: runtimeSchedules.find((schedule) => schedule.schedule_id === "schedule-ui-hour") });
      return;
    }

    if (method === "GET" && url.pathname === "/auth/audit") {
      expect(request.headers()["x-agent-api-key"]).toBe("ui-runtime-audit-key");
      await fulfillJson(route, {
        enabled: true,
        total: 3,
        entries: [
          {
            seq: 3,
            timestamp: "2026-07-02T12:00:03.000Z",
            method: "GET",
            path: "/metadata",
            scope: "metadata:read",
            status: "rate_limited",
            reason: "Limite de requisições da chave de API excedido.",
            key_id: "key-1",
            source: "scoped",
          },
          {
            seq: 2,
            timestamp: "2026-07-02T12:00:02.000Z",
            method: "POST",
            path: "/sessions",
            scope: "sessions:write",
            status: "allowed",
            reason: null,
            key_id: "key-1",
            source: "scoped",
          },
          {
            seq: 1,
            timestamp: "2026-07-02T12:00:01.000Z",
            method: "GET",
            path: "/metadata",
            scope: "metadata:read",
            status: "rejected",
            reason: "Chave de API ausente.",
            key_id: null,
            source: "auth_failed",
          },
        ],
      });
      return;
    }

    if (method === "GET" && url.pathname === "/auth/keys") {
      expect(request.headers()["x-agent-api-key"]).toBe("ui-runtime-audit-key");
      await fulfillJson(route, {
        enabled: true,
        agent_id: "reference-interview",
        total: 3,
        sources: {
          AGENT_API_KEYS_PATH: 3,
        },
        file: {
          configured: true,
          path: ".agent-flow/api-keys.json",
          exists: true,
          size: 192,
          mtime: 1782984000,
        },
        revocation: {
          configured: true,
          total: 1,
          file: {
            configured: true,
            path: ".agent-flow/revoked-api-keys.json",
            exists: true,
            size: 34,
            mtime: 1782984001,
          },
        },
        keys: [
          {
            key_id: "reader",
            source: "AGENT_API_KEYS_PATH",
            scopes: ["metadata:read", "auth:read"],
            expires_at: null,
            expired: false,
            revoked: false,
          },
          {
            key_id: "revoked-reader",
            source: "AGENT_API_KEYS_PATH",
            scopes: ["metadata:read"],
            expires_at: null,
            expired: false,
            revoked: true,
          },
          {
            key_id: "expired-reader",
            source: "AGENT_API_KEYS_PATH",
            scopes: ["metadata:read"],
            expires_at: "2026-07-01T12:00:00+00:00",
            expired: true,
            revoked: false,
          },
        ],
      });
      return;
    }

    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not mocked" }) });
  });
}

async function fulfillJson(route, payload) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
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
    offenders: Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === "string" ? element.className : "",
          role: element.getAttribute("role") ?? "",
          label: element.getAttribute("aria-label") ?? "",
          text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
          left: Math.floor(rect.left),
          right: Math.ceil(rect.right),
          width: Math.ceil(rect.width),
        };
      })
      .filter((item) => item.width > 0 && (item.right > window.innerWidth + 1 || item.left < -1))
      .sort((a, b) => b.right - a.right)
      .slice(0, 8),
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
