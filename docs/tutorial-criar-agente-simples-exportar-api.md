# Tutorial: criar um agente simples e exportar a API

Este tutorial mostra o caminho visual para criar um agente simples no Agent Flow Studio, ajustar o prompt dele e exportar uma API FastAPI/Docker pronta para rodar fora do Builder.

O exemplo cria um agente de conversa chamado `atendimento-simples`. Ele usa o template inicial do Studio, que ja vem com:

- endpoint de sessoes (`sessions`);
- prompt `system`;
- schema de estado `session_state`;
- grafo basico com entrada, safety, LLM, espera por usuario e finalizacao;
- runtime Python/LangGraph geravel pelo Builder.

## 1. Subir o Builder e a UI

Abra dois terminais na raiz do repositorio `AGENTES IA`.

Terminal 1:

```powershell
npm run dev:builder-api
```

Espere aparecer que a API local esta em `http://127.0.0.1:3333`.

Terminal 2:

```powershell
npm run dev:builder-ui
```

Abra no navegador:

```text
http://127.0.0.1:5173
```

## 2. Criar o flow do agente

Na tela principal do Builder:

1. No topo da tela, encontre o seletor `Flow`.
2. Ao lado do seletor, clique no botao com icone `+`.
   - O tooltip/rotulo do botao e `Criar flow`.
   - Alternativa: pressione `Ctrl+K`, digite `Criar flow` e selecione a acao `Criar flow`.
3. O navegador abre um prompt com o texto `ID do novo flow`.
4. Preencha:

```text
atendimento-simples
```

5. Confirme o prompt.

O Studio cria automaticamente:

```text
flows/atendimento-simples/agent.flow.json
flows/atendimento-simples/prompts/system.md
flows/atendimento-simples/schemas/session_state.schema.json
```

O nome visivel vira `Atendimento Simples`. O recurso da API fica como `sessions`, que e o padrao para agentes simples de conversa.

## 3. Editar o comportamento do agente

Depois de criar o flow:

1. Abra a aba `Arquivos` no painel lateral/inspector.
   - Alternativa: pressione `Ctrl+K`, digite `Abrir Arquivos` e selecione `Abrir Arquivos`.
2. Na secao `Prompt`, deixe selecionado o prompt `system`.
3. No editor de texto do prompt, substitua ou ajuste o conteudo para algo simples, por exemplo:

```markdown
# Atendimento Simples

Voce e um agente de atendimento inicial.

Responda em portugues brasileiro, de forma curta e clara.
Quando o usuario fizer uma pergunta, explique o proximo passo e pergunte apenas uma coisa por vez.
Se faltar informacao, peca a informacao mais importante primeiro.
```

4. Clique em `Salvar prompt`.
5. Se o botao `Salvar` no topo da tela estiver habilitado, clique nele tambem para salvar o workspace.

## 4. Validar o flow

Antes de gerar qualquer artefato:

1. Clique no botao `Validar` no topo da tela.
   - Alternativa: pressione `Ctrl+Enter`.
   - Alternativa: abra a aba `Validacao` e clique em `Validar flow`.
2. Espere o status de validacao.
3. Se aparecer `Nenhum diagnostico`, o flow esta pronto para gerar.
4. Se aparecer erro, clique no diagnostico para navegar ate o item com problema, corrija e valide novamente.

## 5. Gerar o pacote LangGraph

A API Docker final so e liberada depois de gerar e aprovar o sandbox LangGraph do flow atual.

1. No topo da tela, clique em `LangGraph`.
   - Tooltip: `Gerar pacote LangGraph para LangSmith`.
   - Alternativa: pressione `Ctrl+K`, digite `Gerar LangGraph` e selecione a acao.
2. Aguarde o status de sucesso.
3. O Studio abre a aba `Artefato` mostrando o pacote gerado.

Para este exemplo, o diretorio esperado e parecido com:

```text
generated/atendimento-simples-langgraph-sandbox
```

## 6. Aprovar o sandbox

1. No topo da tela, clique em `Aprovar`.
   - Alternativa: pressione `Ctrl+K`, digite `Aprovar sandbox` e selecione a acao.
2. Aguarde a mensagem de aprovacao.
3. Confira se o botao `API Docker` ficou habilitado.

Em uso real, rode o agente no `Studio` e aprove somente a versao testada. Para este tutorial basico, a aprovacao registra o hash do sandbox gerado para liberar a exportacao da API.

## 7. Gerar a API Docker

1. Clique no botao `API Docker` no topo da tela.
   - Alternativa: pressione `Ctrl+K`, digite `Gerar API Docker` e selecione a acao.
2. Aguarde a geracao do runtime final.
3. O Studio abre novamente a aba `Artefato`.
4. Na secao `API Docker final`, confira:
   - `Tipo`;
   - `Recurso`;
   - `Flow`;
   - `Env local`;
   - `ZIP`.

O diretorio esperado e parecido com:

```text
generated/atendimento-simples-runtime
```

## 8. Preparar e subir a API localmente

Na aba `Artefato`, dentro de `API Docker final`:

1. Confira o campo `Runtime URL`.
   - Valor padrao: `http://127.0.0.1:8080`.
2. Se a porta `8080` estiver livre, mantenha os campos:
   - `API`: `8080`
   - `Postgres`: `5433`
   - `Redis`: `6380`
3. Se alguma porta estiver ocupada, altere os inputs `API`, `Postgres` ou `Redis` e clique em `Aplicar portas no compose`.
4. Clique em `Preparar .env`.
   - Isso cria o `.env` local do runtime a partir do exemplo.
   - Por padrao, o runtime usa `MOCK_LLM=true`, entao da para testar sem chave real de modelo.
5. Clique em `Build`.
6. Quando o build terminar, clique em `Up CPU`.
7. Clique em `Status` ou `Inspecionar` para confirmar os containers.
8. Clique em `Smoke`.

Se o smoke passar, a API esta rodando localmente.

Links uteis aparecem no painel:

- `Docs`: normalmente `http://127.0.0.1:8080/docs`
- `OpenAPI`: normalmente `http://127.0.0.1:8080/openapi.json`

## 9. Baixar o ZIP final da API

Na aba `Artefato`:

1. Confira o `Checklist de entrega`.
2. Complete a `Proxima acao` indicada, se houver.
3. Quando o checklist estiver pronto, clique em `Baixar zip final`.

Se o botao mostrar `Baixar zip preliminar`, ainda existe alguma etapa pendente, como `.env`, `Build`, `Up` ou `Smoke`.

O ZIP final exclui valores de `.env` e inclui o manifesto de exportacao. Ele e o pacote que pode sair do Builder.

## 10. Testar a API fora do Builder

Depois de baixar ou localizar o runtime gerado, voce tambem pode operar pelo terminal.

Exemplo:

```powershell
cd generated/atendimento-simples-runtime
docker compose up -d --build
```

Abra:

```text
http://127.0.0.1:8080/docs
```

O recurso principal do agente e `sessions`. Na documentacao Swagger, o fluxo basico e:

1. Criar uma sessao em `POST /sessions`.
2. Iniciar a sessao se ela nao iniciar automaticamente.
3. Enviar uma mensagem de usuario no endpoint de turno.
4. Consultar transcript/eventos.
5. Finalizar a sessao quando terminar.

## 11. Usar LLM real em vez de mock

Para o tutorial, mantenha `MOCK_LLM=true`.

Para usar OpenAI real:

1. Abra o `.env` dentro do runtime gerado.
2. Ajuste:

```text
MOCK_LLM=false
OPENAI_API_KEY=coloque-sua-chave-aqui
OPENAI_BASE_URL=
```

3. Rode novamente:

```powershell
docker compose up -d --build
```

Nao coloque chaves no `agent.flow.json`, em prompts, schemas ou arquivos versionados do Studio.

## Checklist rapido

Use esta ordem quando quiser repetir o processo:

1. `+` / `Criar flow`
2. preencher `ID do novo flow`
3. `Arquivos` > `Prompt` > editar `system`
4. `Salvar prompt`
5. `Salvar`
6. `Validar`
7. `LangGraph`
8. `Aprovar`
9. `API Docker`
10. `Preparar .env`
11. `Build`
12. `Up CPU`
13. `Smoke`
14. `Baixar zip final`
