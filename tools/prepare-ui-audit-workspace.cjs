const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.join(repoRoot, ".tmp", "ui-theme-workspace");
const sourceFlowDir = path.join(repoRoot, "flows", "reference-interview");
const targetFlowDir = path.join(workspaceRoot, "flows", "reference-interview");

fs.rmSync(workspaceRoot, { recursive: true, force: true });
fs.mkdirSync(path.dirname(targetFlowDir), { recursive: true });
fs.cpSync(sourceFlowDir, targetFlowDir, { recursive: true });
fs.rmSync(path.join(targetFlowDir, ".agent-flow"), { recursive: true, force: true });
fs.cpSync(path.join(repoRoot, "runtime.manifest.json"), path.join(workspaceRoot, "runtime.manifest.json"));

console.log(`Prepared UI audit workspace at ${workspaceRoot}`);
