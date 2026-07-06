import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "./server.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createWorkspaceFixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-api-langsmith-deploy-"));
  await mkdir(path.join(workspaceRoot, "flows"), { recursive: true });
  await cp(
    path.join(REPO_ROOT, "flows", "reference-interview"),
    path.join(workspaceRoot, "flows", "reference-interview"),
    { recursive: true },
  );
  await rm(path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow"), { recursive: true, force: true });
  await cp(path.join(REPO_ROOT, "runtime.manifest.json"), path.join(workspaceRoot, "runtime.manifest.json"));
  return workspaceRoot;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return raw ? JSON.parse(raw) : {};
}

test("Builder API triggers optional LangSmith cloud deployment through a governed endpoint", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const previousDeployUrl = process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_URL;
  const previousDeployToken = process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TOKEN;
  const previousDeployTimeout = process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TIMEOUT_MS;
  t.after(() => {
    if (previousDeployUrl === undefined) {
      delete process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_URL;
    } else {
      process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_URL = previousDeployUrl;
    }
    if (previousDeployToken === undefined) {
      delete process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TOKEN;
    } else {
      process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TOKEN = previousDeployToken;
    }
    if (previousDeployTimeout === undefined) {
      delete process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TIMEOUT_MS = previousDeployTimeout;
    }
  });

  const deployRequests = [];
  const deployServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/deploy");
    deployRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      deployment: {
        status: "verified",
        deploymentName: "Automated cloud deploy",
        deploymentId: "cloud-deploy-automation-001",
        deploymentUrl: "https://smith.langchain.com/o/acme/projects/auto?token=deploy-token-should-drop",
        traceUrl: "https://smith.langchain.com/o/acme/runs/auto?api_key=deploy-token-should-drop",
        note: "deploy concluido sem payload bruto",
      },
    }));
  });
  await new Promise((resolve) => deployServer.listen(0, "127.0.0.1", resolve));
  t.after(() => deployServer.close());
  const deployAddress = deployServer.address();
  process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_URL = `http://127.0.0.1:${deployAddress.port}/deploy`;
  process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TOKEN = "langsmith-deploy-token";
  process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TIMEOUT_MS = "1500";

  const app = buildApp({ workspaceRoot });

  const sandbox = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate-langgraph-sandbox",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-langgraph-sandbox" },
  });
  assert.equal(sandbox.statusCode, 200);

  const approval = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/approve-langgraph-sandbox",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-langgraph-sandbox" },
  });
  assert.equal(approval.statusCode, 200);

  const handoffResponse = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate-langsmith-cloud-handoff",
  });
  assert.equal(handoffResponse.statusCode, 200);
  const handoff = handoffResponse.json().handoff;
  assert.equal(handoff.status, "ready");

  const automationStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/langsmith-cloud-deployment-automation",
  });
  const automationStatusBody = automationStatus.json();
  assert.equal(automationStatus.statusCode, 200);
  assert.equal(automationStatusBody.format, "agent-flow-builder.langsmith-cloud-deployment-automation-status.v1");
  assert.equal(automationStatusBody.configured, true);
  assert.equal(automationStatusBody.tokenConfigured, true);
  assert.equal(automationStatusBody.governance.deployAuthTokenInHeaderOnly, true);
  assert.equal(automationStatusBody.governance.deployAuthTokenInBody, false);
  assert.equal(automationStatusBody.governance.storesDeployToken, false);
  assert.equal(JSON.stringify(automationStatusBody).includes("langsmith-deploy-token"), false);
  assert.equal(JSON.stringify(automationStatusBody).includes(String(deployAddress.port)), false);

  const viewerDeploy = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/langsmith-cloud-deployment-automation/deploy",
    headers: { "content-type": "application/json" },
    payload: {
      deploymentName: "Viewer automation",
      recordedBy: "viewer",
      recordedRole: "viewer",
    },
  });
  assert.equal(viewerDeploy.statusCode, 403);

  const automatedDeploy = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/langsmith-cloud-deployment-automation/deploy",
    headers: { "content-type": "application/json" },
    payload: {
      deploymentName: "Requested automated deploy",
      recordedBy: "operator-user",
      recordedRole: "operator",
    },
  });
  assert.equal(automatedDeploy.statusCode, 200);
  const deployResult = automatedDeploy.json();
  assert.equal(deployResult.format, "agent-flow-builder.langsmith-cloud-deployment-automation-result.v1");
  assert.equal(deployResult.deployment.status, "verified");
  assert.equal(deployResult.deployment.deploymentName, "Automated cloud deploy");
  assert.equal(deployResult.deployment.deploymentUrl, "https://smith.langchain.com/o/acme/projects/auto");
  assert.equal(deployResult.deployment.traceUrl, "https://smith.langchain.com/o/acme/runs/auto");
  assert.equal(deployResult.deployment.automation.statusCode, 200);
  assert.equal(deployResult.status.governance.deployAuthTokenInBody, false);
  assert.equal(deployResult.deployments.deploymentCount, 1);
  assert.equal(deployRequests.length, 1);
  assert.equal(deployRequests[0].authorization, "Bearer langsmith-deploy-token");
  assert.equal(deployRequests[0].body.format, "agent-flow-builder.langsmith-cloud-deployment-automation-request.v1");
  assert.equal(deployRequests[0].body.handoff.packageHash, handoff.packageHash);
  assert.equal(deployRequests[0].body.requestedBy, "operator-user");
  assert.equal(deployRequests[0].body.requestedRole, "operator");
  assert.equal(JSON.stringify(deployRequests[0].body).includes("langsmith-deploy-token"), false);
  assert.equal(JSON.stringify(deployResult).includes("langsmith-deploy-token"), false);
  assert.equal(JSON.stringify(deployResult).includes("deploy-token-should-drop"), false);
});
