import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DockerRuntimeStatus } from "./docker-runtime.ts";
import { normalizeWorkspaceRoot, safeResolve, toWorkspaceRelative, WorkspaceError } from "./workspace.ts";

const MODEL_IMAGE_CATALOG_FORMAT = "agent-flow-builder.model-image-catalog.v1";
const MODEL_IMAGE_REMOTE_REGISTRY_FORMAT = "agent-flow-builder.model-image-remote-registry.v1";
const MODEL_IMAGE_CATALOG_PATH = ".agent-flow/model-images/catalog.afmodelimages.json";
const MODEL_IMAGE_REMOTE_REGISTRY_PATH = ".agent-flow/model-images/remote-registries.afmodelregistry.json";
const MODEL_IMAGE_CATALOG_IMPORTS_PATH = ".agent-flow/model-images/imports";
const MODEL_IMAGE_CATALOG_PATHS_ENV = "AGENT_FLOW_MODEL_IMAGE_CATALOG_PATHS";
const MODEL_IMAGE_CATALOG_REMOTE_URLS_ENV = "AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS";
const MODEL_IMAGE_CATALOG_REMOTE_TIMEOUT_MS = 5_000;
const MODEL_IMAGE_CATALOG_REMOTE_MAX_BYTES = 1_000_000;
const MODEL_IMAGE_CATALOG_CENTRAL_SYNC_FORMAT = "agent-flow-builder.model-image-catalog-central-sync-request.v1";
const MODEL_IMAGE_CATALOG_CENTRAL_STATUS_FORMAT = "agent-flow-builder.model-image-catalog-central-status.v1";
const MODEL_IMAGE_CATALOG_CENTRAL_URL_ENV = "AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL";
const MODEL_IMAGE_CATALOG_CENTRAL_TOKEN_ENV = "AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TOKEN";
const MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_MS";
const MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_MS = 5_000;
const MODEL_IMAGE_CATALOG_CENTRAL_MAX_BYTES = 2_000_000;

export interface ModelImageCatalogItem {
  id: string;
  tag: string;
  registryHost: string | null;
  versionTag: string | null;
  models: string[];
  archivePath: string | null;
  buildCommand: string | null;
  exportCommand: string | null;
  loadCommand: string | null;
  pushCommand: string | null;
  sourceOutDir: string;
  sourceTarget: DockerRuntimeStatus["target"];
  flowId: string | null;
  flowVersion: string | null;
  flowHash: string | null;
  agents: Array<{ id: string; flowId: string; routePrefix: string; resourceName: string }>;
  createdAt: string;
  updatedAt: string;
  revision: number;
  contentHash: string;
  notes: string | null;
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    source: "docker-runtime";
  };
}

export interface ModelImageCatalog {
  format: typeof MODEL_IMAGE_CATALOG_FORMAT;
  version: 1;
  generatedAt: string;
  itemCount: number;
  items: ModelImageCatalogItem[];
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    fileBacked: true;
    path: typeof MODEL_IMAGE_CATALOG_PATH;
  };
}

export interface ModelImageCatalogRegisterResult {
  catalog: ModelImageCatalog;
  item: ModelImageCatalogItem;
  created: boolean;
  updated: boolean;
}

export interface ModelImageCatalogMergeResult {
  catalog: ModelImageCatalog;
  added: number;
  updated: number;
  unchanged: number;
}

export interface ModelImageCatalogDiscoverySearchPath {
  source: "workspace-imports" | "configured-path";
  path: string;
  exists: boolean;
  fileCount: number;
  error: string | null;
}

export interface ModelImageCatalogDiscoveryItem {
  id: string;
  source: "workspace-imports" | "configured-path";
  path: string;
  itemCount: number;
  tags: string[];
  latestUpdatedAt: string | null;
  contentHash: string;
}

export interface ModelImageCatalogDiscoveryResult {
  format: "agent-flow-builder.model-image-catalog-discovery.v1";
  generatedAt: string;
  catalogCount: number;
  itemCount: number;
  searchPaths: ModelImageCatalogDiscoverySearchPath[];
  catalogs: ModelImageCatalogDiscoveryItem[];
  errors: Array<{ path: string; message: string }>;
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    localOnly: true;
    defaultImportDir: typeof MODEL_IMAGE_CATALOG_IMPORTS_PATH;
    configuredPathsEnv: typeof MODEL_IMAGE_CATALOG_PATHS_ENV;
  };
}

export interface ModelImageCatalogSyncDiscoveredResult extends ModelImageCatalogMergeResult {
  discovery: ModelImageCatalogDiscoveryResult;
  mergedCatalogCount: number;
}

export type ModelImageRemoteRegistryEntryStatus = "candidate" | "approved" | "disabled";
export type ModelImageRemoteRegistryEntrySource = "workspace-registry" | "env";

export interface ModelImageRemoteRegistryEntry {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  status: ModelImageRemoteRegistryEntryStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  lastStatusCode: number | null;
  lastItemCount: number | null;
  lastError: string | null;
  contentHash: string;
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    sendsCredentials: false;
    source: "workspace-registry";
  };
}

export interface ModelImageRemoteRegistry {
  format: typeof MODEL_IMAGE_REMOTE_REGISTRY_FORMAT;
  version: 1;
  generatedAt: string;
  registryCount: number;
  enabledCount: number;
  registries: ModelImageRemoteRegistryEntry[];
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    sendsCredentials: false;
    fileBacked: true;
    path: typeof MODEL_IMAGE_REMOTE_REGISTRY_PATH;
    configuredUrlsEnv: typeof MODEL_IMAGE_CATALOG_REMOTE_URLS_ENV;
  };
}

export interface ModelImageRemoteRegistrySaveResult {
  registry: ModelImageRemoteRegistry;
  entry: ModelImageRemoteRegistryEntry;
  created: boolean;
  updated: boolean;
}

export interface ModelImageCatalogRemoteRegistryItem {
  id: string;
  source: ModelImageRemoteRegistryEntrySource;
  name: string;
  url: string;
  enabled: boolean;
  curationStatus: ModelImageRemoteRegistryEntryStatus | "env";
  statusCode: number | null;
  itemCount: number;
  tags: string[];
  latestUpdatedAt: string | null;
  contentHash: string | null;
  error: string | null;
}

export interface ModelImageCatalogRemoteRegistryResult {
  format: "agent-flow-builder.model-image-catalog-remote-registry.v1";
  generatedAt: string;
  registryCount: number;
  itemCount: number;
  registries: ModelImageCatalogRemoteRegistryItem[];
  errors: Array<{ url: string; message: string }>;
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    sendsCredentials: false;
    configuredUrlsEnv: typeof MODEL_IMAGE_CATALOG_REMOTE_URLS_ENV;
    workspaceRegistryPath: typeof MODEL_IMAGE_REMOTE_REGISTRY_PATH;
    timeoutMs: typeof MODEL_IMAGE_CATALOG_REMOTE_TIMEOUT_MS;
    maxPayloadBytes: typeof MODEL_IMAGE_CATALOG_REMOTE_MAX_BYTES;
  };
}

export interface ModelImageCatalogSyncRemoteResult extends ModelImageCatalogMergeResult {
  remote: ModelImageCatalogRemoteRegistryResult;
  mergedRegistryCount: number;
}

export interface ModelImageCatalogCentralStatus {
  format: typeof MODEL_IMAGE_CATALOG_CENTRAL_STATUS_FORMAT;
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedItemCount: number | null;
  pulledItemCount: number | null;
  error: string | null;
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    sendsDockerCredentials: false;
    sendsEnvValues: false;
    sendsCatalog: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof MODEL_IMAGE_CATALOG_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof MODEL_IMAGE_CATALOG_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof MODEL_IMAGE_CATALOG_CENTRAL_MAX_BYTES;
  };
}

export interface ModelImageCatalogSyncCentralResult extends ModelImageCatalogMergeResult {
  central: ModelImageCatalogCentralStatus;
  pushedItemCount: number;
  pulledItemCount: number;
}

export async function loadModelImageCatalog(workspaceRoot: string): Promise<ModelImageCatalog> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const filePath = safeResolve(root, MODEL_IMAGE_CATALOG_PATH);
  let raw = "";
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return emptyModelImageCatalog();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WorkspaceError("Catálogo de imagens de modelo não é JSON válido.", 422, error);
  }
  return normalizeModelImageCatalog(parsed);
}

export async function loadModelImageRemoteRegistry(workspaceRoot: string): Promise<ModelImageRemoteRegistry> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const filePath = safeResolve(root, MODEL_IMAGE_REMOTE_REGISTRY_PATH);
  let raw = "";
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return emptyModelImageRemoteRegistry();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WorkspaceError("Registry remoto de imagens de modelo não é JSON válido.", 422, error);
  }
  return normalizeModelImageRemoteRegistry(parsed);
}

export async function saveModelImageRemoteRegistryEntry(
  workspaceRoot: string,
  payload: unknown,
): Promise<ModelImageRemoteRegistrySaveResult> {
  const incoming = normalizeModelImageRemoteRegistryEntry(payload);
  const registry = await loadModelImageRemoteRegistry(workspaceRoot);
  const existing = registry.registries.find((entry) => entry.id === incoming.id || entry.url === incoming.url);
  const now = new Date().toISOString();
  const entry: ModelImageRemoteRegistryEntry = {
    ...incoming,
    id: existing?.id ?? incoming.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastCheckedAt: existing?.lastCheckedAt ?? null,
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    lastStatusCode: existing?.lastStatusCode ?? null,
    lastItemCount: existing?.lastItemCount ?? null,
    lastError: existing?.lastError ?? null,
    contentHash: "",
  };
  const withHash = { ...entry, contentHash: modelImageRemoteRegistryEntryContentHash(entry) };
  const nextEntries = sortModelImageRemoteRegistryEntries([
    withHash,
    ...registry.registries.filter((candidate) => candidate.id !== withHash.id && candidate.url !== withHash.url),
  ]);
  await writeModelImageRemoteRegistry(workspaceRoot, nextEntries);
  const nextRegistry = await loadModelImageRemoteRegistry(workspaceRoot);
  return {
    registry: nextRegistry,
    entry: nextRegistry.registries.find((candidate) => candidate.id === withHash.id) ?? withHash,
    created: !existing,
    updated: Boolean(existing),
  };
}

export async function removeModelImageRemoteRegistryEntry(
  workspaceRoot: string,
  entryId: string,
): Promise<ModelImageRemoteRegistry> {
  const registry = await loadModelImageRemoteRegistry(workspaceRoot);
  const nextEntries = registry.registries.filter((entry) => entry.id !== entryId);
  if (nextEntries.length === registry.registries.length) {
    throw new WorkspaceError("Registry remoto de imagens não encontrado.", 404, { entryId });
  }
  await writeModelImageRemoteRegistry(workspaceRoot, nextEntries);
  return loadModelImageRemoteRegistry(workspaceRoot);
}

export async function registerRuntimeModelImage(
  workspaceRoot: string,
  status: DockerRuntimeStatus,
  notes?: string,
): Promise<ModelImageCatalogRegisterResult> {
  const distribution = status.modelSetup.distribution;
  if (!distribution.modelImageTag) {
    throw new WorkspaceError("Runtime não possui OLLAMA_MODEL_IMAGE para registrar no catálogo.", 409, distribution);
  }

  const catalog = await loadModelImageCatalog(workspaceRoot);
  const now = new Date().toISOString();
  const existing = catalog.items.find((item) => item.tag === distribution.modelImageTag);
  const draft: ModelImageCatalogItem = {
    id: existing?.id ?? `model-image-${shortHash(distribution.modelImageTag)}`,
    tag: distribution.modelImageTag,
    registryHost: registryHostFromImageTag(distribution.modelImageTag),
    versionTag: versionFromImageTag(distribution.modelImageTag),
    models: [...status.modelSetup.models],
    archivePath: distribution.modelImageArchivePath,
    buildCommand: distribution.modelImageCommand,
    exportCommand: distribution.modelImageExportCommand,
    loadCommand: distribution.modelImageLoadCommand,
    pushCommand: distribution.modelImagePushCommand,
    sourceOutDir: status.outDir,
    sourceTarget: status.target,
    flowId: status.flowId,
    flowVersion: status.flowVersion,
    flowHash: status.flowHash,
    agents: status.agents.map((agent) => ({
      id: agent.id,
      flowId: agent.flowId,
      routePrefix: agent.routePrefix,
      resourceName: agent.resourceName,
    })),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revision: existing ? existing.revision + 1 : 1,
    contentHash: "",
    notes: normalizeOptionalText(notes) ?? existing?.notes ?? null,
    governance: {
      excludesSecretValues: true,
      storesDockerCredentials: false,
      storesEnvValues: false,
      source: "docker-runtime",
    },
  };
  const item = { ...draft, contentHash: modelImageItemContentHash(draft) };
  const changed = !existing || existing.contentHash !== item.contentHash || existing.notes !== item.notes;
  const nextItems = changed
    ? sortModelImageItems([item, ...catalog.items.filter((candidate) => candidate.tag !== item.tag)])
    : catalog.items;
  if (changed) {
    await writeModelImageCatalog(workspaceRoot, nextItems);
  }
  const nextCatalog = changed ? await loadModelImageCatalog(workspaceRoot) : catalog;
  return {
    catalog: nextCatalog,
    item: nextCatalog.items.find((candidate) => candidate.tag === item.tag) ?? item,
    created: !existing,
    updated: Boolean(existing && changed),
  };
}

export async function mergeModelImageCatalog(
  workspaceRoot: string,
  payload: unknown,
): Promise<ModelImageCatalogMergeResult> {
  const incoming = normalizeModelImageCatalog(payload);
  return mergeModelImageCatalogItems(workspaceRoot, incoming.items);
}

export async function discoverModelImageCatalogs(workspaceRoot: string): Promise<ModelImageCatalogDiscoveryResult> {
  return (await discoverModelImageCatalogsInternal(workspaceRoot)).discovery;
}

export async function syncDiscoveredModelImageCatalogs(workspaceRoot: string): Promise<ModelImageCatalogSyncDiscoveredResult> {
  const discovered = await discoverModelImageCatalogsInternal(workspaceRoot);
  const merged = await mergeModelImageCatalogItems(
    workspaceRoot,
    discovered.catalogs.flatMap((catalog) => catalog.items),
  );
  return {
    ...merged,
    discovery: discovered.discovery,
    mergedCatalogCount: discovered.catalogs.length,
  };
}

export async function discoverRemoteModelImageCatalogs(workspaceRoot?: string): Promise<ModelImageCatalogRemoteRegistryResult> {
  return (await discoverRemoteModelImageCatalogsInternal(workspaceRoot)).remote;
}

export async function syncRemoteModelImageCatalogs(workspaceRoot: string): Promise<ModelImageCatalogSyncRemoteResult> {
  const remote = await discoverRemoteModelImageCatalogsInternal(workspaceRoot);
  const merged = await mergeModelImageCatalogItems(
    workspaceRoot,
    remote.catalogs.flatMap((catalog) => catalog.items),
  );
  if (remote.workspaceRegistryUpdates.length) {
    const syncedAt = new Date().toISOString();
    for (const source of remote.remote.registries) {
      if (source.source === "workspace-registry" && !source.error) {
        const entry = remote.workspaceRegistryUpdates.find((candidate) => candidate.id === source.id);
        if (entry) {
          entry.lastSyncedAt = syncedAt;
          entry.updatedAt = syncedAt;
        }
      }
    }
    await writeModelImageRemoteRegistry(workspaceRoot, remote.workspaceRegistryUpdates);
  }
  return {
    ...merged,
    remote: remote.remote,
    mergedRegistryCount: remote.catalogs.length,
  };
}

export async function loadModelImageCatalogCentralStatus(): Promise<ModelImageCatalogCentralStatus> {
  return buildModelImageCatalogCentralStatus(modelImageCatalogCentralConfig());
}

export async function syncCentralModelImageCatalogs(workspaceRoot: string): Promise<ModelImageCatalogSyncCentralResult> {
  const config = modelImageCatalogCentralConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Serviço central de catálogo inválido: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError(
      `Configure ${MODEL_IMAGE_CATALOG_CENTRAL_URL_ENV} para sincronizar o catálogo central de imagens.`,
      400,
    );
  }

  const localCatalog = await loadModelImageCatalog(workspaceRoot);
  const fetched = await fetchCentralModelImageCatalogSync(config, localCatalog);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body);
  } catch (error) {
    throw new WorkspaceError("Serviço central de catálogo não retornou JSON válido.", 502, error);
  }
  const incoming = normalizeModelImageCatalog(
    isRecord(parsed) && "catalog" in parsed ? parsed.catalog : parsed,
  );
  const merged = await mergeModelImageCatalogItems(workspaceRoot, incoming.items);
  const syncedAt = new Date().toISOString();
  return {
    ...merged,
    central: buildModelImageCatalogCentralStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedItemCount: localCatalog.itemCount,
      pulledItemCount: incoming.itemCount,
      error: null,
    }),
    pushedItemCount: localCatalog.itemCount,
    pulledItemCount: incoming.itemCount,
  };
}

async function mergeModelImageCatalogItems(
  workspaceRoot: string,
  incomingItems: ModelImageCatalogItem[],
): Promise<ModelImageCatalogMergeResult> {
  const existing = await loadModelImageCatalog(workspaceRoot);
  const byTag = new Map(existing.items.map((item) => [item.tag, item]));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const item of incomingItems) {
    const previous = byTag.get(item.tag);
    if (!previous) {
      byTag.set(item.tag, item);
      added += 1;
      continue;
    }
    if (previous.contentHash === item.contentHash) {
      unchanged += 1;
      continue;
    }
    const previousTime = Date.parse(previous.updatedAt);
    const incomingTime = Date.parse(item.updatedAt);
    if (!Number.isFinite(previousTime) || !Number.isFinite(incomingTime) || incomingTime >= previousTime) {
      byTag.set(item.tag, {
        ...item,
        createdAt: previous.createdAt,
        revision: Math.max(previous.revision + 1, item.revision),
      });
      updated += 1;
    } else {
      unchanged += 1;
    }
  }
  await writeModelImageCatalog(workspaceRoot, sortModelImageItems([...byTag.values()]));
  return {
    catalog: await loadModelImageCatalog(workspaceRoot),
    added,
    updated,
    unchanged,
  };
}

async function discoverRemoteModelImageCatalogsInternal(workspaceRoot?: string): Promise<{
  remote: ModelImageCatalogRemoteRegistryResult;
  catalogs: ModelImageCatalog[];
  workspaceRegistryUpdates: ModelImageRemoteRegistryEntry[];
}> {
  const sources = await remoteModelImageCatalogSources(workspaceRoot);
  const registries: ModelImageCatalogRemoteRegistryItem[] = [];
  const catalogs: ModelImageCatalog[] = [];
  const errors: Array<{ url: string; message: string }> = [];
  const workspaceRegistryUpdates = workspaceRoot ? (await loadModelImageRemoteRegistry(workspaceRoot)).registries : [];

  for (const source of sources) {
    try {
      const fetched = await fetchRemoteModelImageCatalog(source.url);
      const catalog = normalizeModelImageCatalog(JSON.parse(fetched.body) as unknown);
      catalogs.push(catalog);
      updateWorkspaceRemoteRegistryEntry(workspaceRegistryUpdates, source, {
        checkedAt: new Date().toISOString(),
        syncedAt: null,
        statusCode: fetched.statusCode,
        itemCount: catalog.itemCount,
        error: null,
      });
      registries.push({
        id: source.id,
        source: source.source,
        name: source.name,
        url: redactUrlForDisplay(source.url),
        enabled: source.enabled,
        curationStatus: source.status,
        statusCode: fetched.statusCode,
        itemCount: catalog.itemCount,
        tags: catalog.items.map((item) => item.tag),
        latestUpdatedAt: latestModelImageUpdatedAt(catalog),
        contentHash: shortHash(fetched.body),
        error: null,
      });
    } catch (error) {
      const message = errorMessage(error);
      updateWorkspaceRemoteRegistryEntry(workspaceRegistryUpdates, source, {
        checkedAt: new Date().toISOString(),
        syncedAt: null,
        statusCode: null,
        itemCount: 0,
        error: message,
      });
      errors.push({ url: redactUrlForDisplay(source.url), message });
      registries.push({
        id: source.id,
        source: source.source,
        name: source.name,
        url: redactUrlForDisplay(source.url),
        enabled: source.enabled,
        curationStatus: source.status,
        statusCode: null,
        itemCount: 0,
        tags: [],
        latestUpdatedAt: null,
        contentHash: null,
        error: message,
      });
    }
  }

  const itemCount = catalogs.reduce((total, catalog) => total + catalog.itemCount, 0);
  return {
    catalogs,
    remote: {
      format: "agent-flow-builder.model-image-catalog-remote-registry.v1",
      generatedAt: new Date().toISOString(),
      registryCount: catalogs.length,
      itemCount,
      registries,
      errors,
      governance: {
        excludesSecretValues: true,
        storesDockerCredentials: false,
        storesEnvValues: false,
        sendsCredentials: false,
        configuredUrlsEnv: MODEL_IMAGE_CATALOG_REMOTE_URLS_ENV,
        workspaceRegistryPath: MODEL_IMAGE_REMOTE_REGISTRY_PATH,
        timeoutMs: MODEL_IMAGE_CATALOG_REMOTE_TIMEOUT_MS,
        maxPayloadBytes: MODEL_IMAGE_CATALOG_REMOTE_MAX_BYTES,
      },
    },
    workspaceRegistryUpdates,
  };
}

async function fetchRemoteModelImageCatalog(url: string): Promise<{ statusCode: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_IMAGE_CATALOG_REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" },
      redirect: "follow",
    });
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MODEL_IMAGE_CATALOG_REMOTE_MAX_BYTES) {
      throw new WorkspaceError("Catálogo remoto excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Catálogo remoto respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MODEL_IMAGE_CATALOG_REMOTE_MAX_BYTES) {
      throw new WorkspaceError("Catálogo remoto excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao buscar catálogo remoto.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

interface ModelImageCatalogCentralConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

function modelImageCatalogCentralConfig(): ModelImageCatalogCentralConfig {
  const errors: string[] = [];
  const configuredUrl = (process.env[MODEL_IMAGE_CATALOG_CENTRAL_URL_ENV] ?? "").trim();
  let url: string | null = null;
  if (configuredUrl) {
    try {
      url = validateCentralModelImageCatalogUrl(configuredUrl);
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  let timeoutMs = MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_MS;
  const configuredTimeout = (process.env[MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_ENV] ?? "").trim();
  if (configuredTimeout) {
    const parsed = Number(configuredTimeout);
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 60_000) {
      errors.push(`${MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_ENV} deve ser inteiro entre 100 e 60000.`);
    } else {
      timeoutMs = parsed;
    }
  }

  return {
    url,
    token: (process.env[MODEL_IMAGE_CATALOG_CENTRAL_TOKEN_ENV] ?? "").trim() || null,
    timeoutMs,
    invalidReason: errors.length ? errors.join(" ") : null,
  };
}

function buildModelImageCatalogCentralStatus(
  config: ModelImageCatalogCentralConfig,
  sync?: Pick<ModelImageCatalogCentralStatus, "lastSyncedAt" | "statusCode" | "pushedItemCount" | "pulledItemCount" | "error">,
): ModelImageCatalogCentralStatus {
  return {
    format: MODEL_IMAGE_CATALOG_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(config.url),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedItemCount: sync?.pushedItemCount ?? null,
    pulledItemCount: sync?.pulledItemCount ?? null,
    error: sync?.error ?? null,
    governance: {
      excludesSecretValues: true,
      storesDockerCredentials: false,
      storesEnvValues: false,
      sendsDockerCredentials: false,
      sendsEnvValues: false,
      sendsCatalog: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: MODEL_IMAGE_CATALOG_CENTRAL_URL_ENV,
      configuredTokenEnv: MODEL_IMAGE_CATALOG_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: MODEL_IMAGE_CATALOG_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralModelImageCatalogSync(
  config: ModelImageCatalogCentralConfig,
  catalog: ModelImageCatalog,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Serviço central de catálogo não configurado.", 400);
  }
  const body = JSON.stringify({
    format: MODEL_IMAGE_CATALOG_CENTRAL_SYNC_FORMAT,
    generatedAt: new Date().toISOString(),
    catalog,
    itemCount: catalog.itemCount,
    governance: {
      excludesSecretValues: true,
      storesDockerCredentials: false,
      storesEnvValues: false,
      sendsDockerCredentials: false,
      sendsEnvValues: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > MODEL_IMAGE_CATALOG_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Catálogo local excede o limite de tamanho permitido para sync central.", 413);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (config.token) {
      headers.authorization = `Bearer ${config.token}`;
    }
    const response = await fetch(config.url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body,
      redirect: "follow",
    });
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MODEL_IMAGE_CATALOG_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Serviço central de catálogo respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MODEL_IMAGE_CATALOG_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar catálogo central.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverModelImageCatalogsInternal(workspaceRoot: string): Promise<{
  discovery: ModelImageCatalogDiscoveryResult;
  catalogs: ModelImageCatalog[];
}> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const currentCatalogPath = safeResolve(root, MODEL_IMAGE_CATALOG_PATH);
  const searchInputs = modelImageCatalogSearchInputs(root);
  const searchPaths: ModelImageCatalogDiscoverySearchPath[] = [];
  const catalogs: ModelImageCatalog[] = [];
  const items: ModelImageCatalogDiscoveryItem[] = [];
  const errors: Array<{ path: string; message: string }> = [];

  for (const input of searchInputs) {
    const displayPath = displayCatalogPath(root, input.absolutePath);
    let candidates: string[] = [];
    try {
      const stats = await stat(input.absolutePath);
      if (stats.isFile()) {
        candidates = isModelImageCatalogFile(input.absolutePath) ? [input.absolutePath] : [];
      } else if (stats.isDirectory()) {
        const entries = await readdir(input.absolutePath, { withFileTypes: true });
        candidates = entries
          .filter((entry) => entry.isFile())
          .map((entry) => path.join(input.absolutePath, entry.name))
          .filter(isModelImageCatalogFile);
      }
      candidates = candidates
        .map((candidate) => path.resolve(candidate))
        .filter((candidate) => candidate.toLowerCase() !== currentCatalogPath.toLowerCase());
      searchPaths.push({
        source: input.source,
        path: displayPath,
        exists: true,
        fileCount: candidates.length,
        error: null,
      });
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "string" ? error.code : "";
      const message = code === "ENOENT" ? "Caminho ainda não existe." : errorMessage(error);
      searchPaths.push({
        source: input.source,
        path: displayPath,
        exists: false,
        fileCount: 0,
        error: message,
      });
      if (code !== "ENOENT") {
        errors.push({ path: displayPath, message });
      }
      continue;
    }

    for (const candidate of candidates) {
      const candidateDisplayPath = displayCatalogPath(root, candidate);
      try {
        const raw = await readFile(candidate, "utf-8");
        const catalog = normalizeModelImageCatalog(JSON.parse(raw) as unknown);
        catalogs.push(catalog);
        items.push({
          id: `model-image-catalog-${shortHash(candidate)}`,
          source: input.source,
          path: candidateDisplayPath,
          itemCount: catalog.itemCount,
          tags: catalog.items.map((item) => item.tag),
          latestUpdatedAt: latestModelImageUpdatedAt(catalog),
          contentHash: shortHash(raw),
        });
      } catch (error) {
        errors.push({ path: candidateDisplayPath, message: errorMessage(error) });
      }
    }
  }

  const itemCount = catalogs.reduce((total, catalog) => total + catalog.itemCount, 0);
  return {
    catalogs,
    discovery: {
      format: "agent-flow-builder.model-image-catalog-discovery.v1",
      generatedAt: new Date().toISOString(),
      catalogCount: items.length,
      itemCount,
      searchPaths,
      catalogs: items.sort((left, right) => (right.latestUpdatedAt ?? "").localeCompare(left.latestUpdatedAt ?? "") || left.path.localeCompare(right.path)),
      errors,
      governance: {
        excludesSecretValues: true,
        storesDockerCredentials: false,
        storesEnvValues: false,
        localOnly: true,
        defaultImportDir: MODEL_IMAGE_CATALOG_IMPORTS_PATH,
        configuredPathsEnv: MODEL_IMAGE_CATALOG_PATHS_ENV,
      },
    },
  };
}

async function remoteModelImageCatalogSources(workspaceRoot?: string): Promise<Array<{
  id: string;
  source: ModelImageRemoteRegistryEntrySource;
  name: string;
  url: string;
  enabled: boolean;
  status: ModelImageRemoteRegistryEntryStatus | "env";
}>> {
  const sources: Array<{
    id: string;
    source: ModelImageRemoteRegistryEntrySource;
    name: string;
    url: string;
    enabled: boolean;
    status: ModelImageRemoteRegistryEntryStatus | "env";
  }> = [];
  if (workspaceRoot) {
    const registry = await loadModelImageRemoteRegistry(workspaceRoot);
    for (const entry of registry.registries) {
      if (entry.enabled && entry.status !== "disabled") {
        sources.push({
          id: entry.id,
          source: "workspace-registry",
          name: entry.name,
          url: entry.url,
          enabled: entry.enabled,
          status: entry.status,
        });
      }
    }
  }
  const envUrls = (process.env[MODEL_IMAGE_CATALOG_REMOTE_URLS_ENV] ?? "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map(validateRemoteModelImageCatalogUrl);
  for (const url of envUrls) {
    sources.push({
      id: `model-image-remote-env-${shortHash(url)}`,
      source: "env",
      name: "Env registry",
      url,
      enabled: true,
      status: "env",
    });
  }
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function validateRemoteModelImageCatalogUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkspaceError(`URL de catálogo remoto inválida: ${value}`, 422);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WorkspaceError(`URL de catálogo remoto deve usar http ou https: ${value}`, 422);
  }
  return url.toString();
}

function validateCentralModelImageCatalogUrl(value: string): string {
  const url = new URL(validateRemoteModelImageCatalogUrl(value));
  if (url.username || url.password) {
    throw new WorkspaceError("Serviço central de catálogo não pode conter usuário ou senha na URL.", 422);
  }
  return url.toString();
}

function redactUrlForDisplay(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return value;
  }
}

function modelImageCatalogSearchInputs(root: string): Array<{
  source: ModelImageCatalogDiscoverySearchPath["source"];
  absolutePath: string;
}> {
  const inputs: Array<{ source: ModelImageCatalogDiscoverySearchPath["source"]; absolutePath: string }> = [
    { source: "workspace-imports", absolutePath: safeResolve(root, MODEL_IMAGE_CATALOG_IMPORTS_PATH) },
  ];
  const configuredPaths = (process.env[MODEL_IMAGE_CATALOG_PATHS_ENV] ?? "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const configuredPath of configuredPaths) {
    inputs.push({
      source: "configured-path",
      absolutePath: path.isAbsolute(configuredPath) ? path.resolve(configuredPath) : safeResolve(root, configuredPath),
    });
  }
  const seen = new Set<string>();
  return inputs.filter((input) => {
    const key = input.absolutePath.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isModelImageCatalogFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".afmodelimages.json");
}

function displayCatalogPath(root: string, absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  const normalizedRoot = root.toLowerCase();
  const normalizedResolved = resolved.toLowerCase();
  if (normalizedResolved === normalizedRoot || normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    return toWorkspaceRelative(root, resolved);
  }
  return `<external>/${path.basename(resolved)}`;
}

function latestModelImageUpdatedAt(catalog: ModelImageCatalog): string | null {
  return catalog.items.reduce<string | null>((latest, item) => {
    if (!latest || item.updatedAt > latest) {
      return item.updatedAt;
    }
    return latest;
  }, null);
}

async function writeModelImageCatalog(workspaceRoot: string, items: ModelImageCatalogItem[]): Promise<void> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const filePath = safeResolve(root, MODEL_IMAGE_CATALOG_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(buildModelImageCatalog(items), null, 2)}\n`, "utf-8");
}

function emptyModelImageCatalog(): ModelImageCatalog {
  return buildModelImageCatalog([]);
}

function buildModelImageCatalog(items: ModelImageCatalogItem[]): ModelImageCatalog {
  return {
    format: MODEL_IMAGE_CATALOG_FORMAT,
    version: 1,
    generatedAt: new Date().toISOString(),
    itemCount: items.length,
    items: sortModelImageItems(items),
    governance: {
      excludesSecretValues: true,
      storesDockerCredentials: false,
      storesEnvValues: false,
      fileBacked: true,
      path: MODEL_IMAGE_CATALOG_PATH,
    },
  };
}

async function writeModelImageRemoteRegistry(
  workspaceRoot: string,
  entries: ModelImageRemoteRegistryEntry[],
): Promise<void> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const filePath = safeResolve(root, MODEL_IMAGE_REMOTE_REGISTRY_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(buildModelImageRemoteRegistry(entries), null, 2)}\n`, "utf-8");
}

function emptyModelImageRemoteRegistry(): ModelImageRemoteRegistry {
  return buildModelImageRemoteRegistry([]);
}

function buildModelImageRemoteRegistry(entries: ModelImageRemoteRegistryEntry[]): ModelImageRemoteRegistry {
  const registries = sortModelImageRemoteRegistryEntries(entries);
  return {
    format: MODEL_IMAGE_REMOTE_REGISTRY_FORMAT,
    version: 1,
    generatedAt: new Date().toISOString(),
    registryCount: registries.length,
    enabledCount: registries.filter((entry) => entry.enabled && entry.status !== "disabled").length,
    registries,
    governance: {
      excludesSecretValues: true,
      storesDockerCredentials: false,
      storesEnvValues: false,
      sendsCredentials: false,
      fileBacked: true,
      path: MODEL_IMAGE_REMOTE_REGISTRY_PATH,
      configuredUrlsEnv: MODEL_IMAGE_CATALOG_REMOTE_URLS_ENV,
    },
  };
}

function normalizeModelImageRemoteRegistry(value: unknown): ModelImageRemoteRegistry {
  if (!isRecord(value) || value.format !== MODEL_IMAGE_REMOTE_REGISTRY_FORMAT) {
    throw new WorkspaceError("Registry remoto de imagens deve usar agent-flow-builder.model-image-remote-registry.v1.", 422, value);
  }
  const registries = Array.isArray(value.registries) ? value.registries.map(normalizeModelImageRemoteRegistryEntry) : [];
  return buildModelImageRemoteRegistry(registries);
}

function normalizeModelImageRemoteRegistryEntry(value: unknown): ModelImageRemoteRegistryEntry {
  if (!isRecord(value)) {
    throw new WorkspaceError("Registry remoto de imagens deve ser objeto.", 422, value);
  }
  const url = validateRemoteModelImageRegistryUrl(requiredText(value.url, "url"));
  const now = new Date().toISOString();
  const status = normalizeRemoteRegistryStatus(value.status);
  const enabled = typeof value.enabled === "boolean" ? value.enabled : status !== "disabled";
  const draft: ModelImageRemoteRegistryEntry = {
    id: normalizeOptionalText(value.id) ?? `model-image-remote-${shortHash(url)}`,
    name: normalizeOptionalText(value.name) ?? registryNameFromUrl(url),
    url,
    enabled: status === "disabled" ? false : enabled,
    status,
    notes: normalizeOptionalText(value.notes),
    createdAt: optionalTimestamp(value.createdAt) ?? now,
    updatedAt: optionalTimestamp(value.updatedAt) ?? now,
    lastCheckedAt: optionalTimestamp(value.lastCheckedAt),
    lastSyncedAt: optionalTimestamp(value.lastSyncedAt),
    lastStatusCode: typeof value.lastStatusCode === "number" && Number.isInteger(value.lastStatusCode)
      ? value.lastStatusCode
      : null,
    lastItemCount: typeof value.lastItemCount === "number" && Number.isInteger(value.lastItemCount) && value.lastItemCount >= 0
      ? value.lastItemCount
      : null,
    lastError: normalizeOptionalText(value.lastError),
    contentHash: "",
    governance: {
      excludesSecretValues: true,
      storesDockerCredentials: false,
      storesEnvValues: false,
      sendsCredentials: false,
      source: "workspace-registry",
    },
  };
  return {
    ...draft,
    contentHash: normalizeOptionalText(value.contentHash) ?? modelImageRemoteRegistryEntryContentHash(draft),
  };
}

function normalizeModelImageCatalog(value: unknown): ModelImageCatalog {
  if (!isRecord(value) || value.format !== MODEL_IMAGE_CATALOG_FORMAT) {
    throw new WorkspaceError("Pacote de catálogo de imagens deve usar agent-flow-builder.model-image-catalog.v1.", 422, value);
  }
  const items = Array.isArray(value.items) ? value.items.map(normalizeModelImageItem) : [];
  return buildModelImageCatalog(items);
}

function normalizeModelImageItem(value: unknown): ModelImageCatalogItem {
  if (!isRecord(value)) {
    throw new WorkspaceError("Item do catálogo de imagens deve ser objeto.", 422, value);
  }
  const tag = requiredText(value.tag, "tag");
  const createdAt = optionalTimestamp(value.createdAt) ?? new Date().toISOString();
  const updatedAt = optionalTimestamp(value.updatedAt) ?? createdAt;
  const revision = typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision > 0
    ? value.revision
    : 1;
  const item: ModelImageCatalogItem = {
    id: normalizeOptionalText(value.id) ?? `model-image-${shortHash(tag)}`,
    tag,
    registryHost: normalizeOptionalText(value.registryHost) ?? registryHostFromImageTag(tag),
    versionTag: normalizeOptionalText(value.versionTag) ?? versionFromImageTag(tag),
    models: Array.isArray(value.models) ? value.models.map(String).map((item) => item.trim()).filter(Boolean) : [],
    archivePath: normalizeOptionalText(value.archivePath),
    buildCommand: normalizeOptionalText(value.buildCommand),
    exportCommand: normalizeOptionalText(value.exportCommand),
    loadCommand: normalizeOptionalText(value.loadCommand),
    pushCommand: normalizeOptionalText(value.pushCommand),
    sourceOutDir: normalizeOptionalText(value.sourceOutDir) ?? "",
    sourceTarget: value.sourceTarget === "runtime-manifest-bundle" ? "runtime-manifest-bundle" : value.sourceTarget === "fastapi-runtime" ? "fastapi-runtime" : null,
    flowId: normalizeOptionalText(value.flowId),
    flowVersion: normalizeOptionalText(value.flowVersion),
    flowHash: normalizeOptionalText(value.flowHash),
    agents: Array.isArray(value.agents)
      ? value.agents.filter(isRecord).map((agent) => ({
          id: normalizeOptionalText(agent.id) ?? "",
          flowId: normalizeOptionalText(agent.flowId) ?? "",
          routePrefix: normalizeOptionalText(agent.routePrefix) ?? "/",
          resourceName: normalizeOptionalText(agent.resourceName) ?? "sessions",
        })).filter((agent) => agent.id)
      : [],
    createdAt,
    updatedAt,
    revision,
    contentHash: "",
    notes: normalizeOptionalText(value.notes),
    governance: {
      excludesSecretValues: true,
      storesDockerCredentials: false,
      storesEnvValues: false,
      source: "docker-runtime",
    },
  };
  return {
    ...item,
    contentHash: normalizeOptionalText(value.contentHash) ?? modelImageItemContentHash(item),
  };
}

function modelImageItemContentHash(item: Omit<ModelImageCatalogItem, "contentHash"> | ModelImageCatalogItem): string {
  return shortHash(stableStringify({
    tag: item.tag,
    models: item.models,
    archivePath: item.archivePath,
    buildCommand: item.buildCommand,
    exportCommand: item.exportCommand,
    loadCommand: item.loadCommand,
    pushCommand: item.pushCommand,
    sourceOutDir: item.sourceOutDir,
    sourceTarget: item.sourceTarget,
    flowId: item.flowId,
    flowVersion: item.flowVersion,
    flowHash: item.flowHash,
    agents: item.agents,
  }));
}

function modelImageRemoteRegistryEntryContentHash(
  entry: Omit<ModelImageRemoteRegistryEntry, "contentHash"> | ModelImageRemoteRegistryEntry,
): string {
  return shortHash(stableStringify({
    name: entry.name,
    url: entry.url,
    enabled: entry.enabled,
    status: entry.status,
    notes: entry.notes,
  }));
}

function sortModelImageItems(items: ModelImageCatalogItem[]): ModelImageCatalogItem[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.tag.localeCompare(right.tag));
}

function sortModelImageRemoteRegistryEntries(entries: ModelImageRemoteRegistryEntry[]): ModelImageRemoteRegistryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }
    return right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name);
  });
}

function normalizeRemoteRegistryStatus(value: unknown): ModelImageRemoteRegistryEntryStatus {
  return value === "approved" || value === "disabled" ? value : "candidate";
}

function validateRemoteModelImageRegistryUrl(value: string): string {
  const url = new URL(validateRemoteModelImageCatalogUrl(value));
  if (url.username || url.password) {
    throw new WorkspaceError("Registry remoto salvo no workspace não pode conter usuário ou senha na URL.", 422);
  }
  return url.toString();
}

function registryNameFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname || "Registry remoto";
  } catch {
    return "Registry remoto";
  }
}

function updateWorkspaceRemoteRegistryEntry(
  entries: ModelImageRemoteRegistryEntry[],
  source: {
    id: string;
    source: ModelImageRemoteRegistryEntrySource;
    status: ModelImageRemoteRegistryEntryStatus | "env";
  },
  update: {
    checkedAt: string;
    syncedAt: string | null;
    statusCode: number | null;
    itemCount: number;
    error: string | null;
  },
): void {
  if (source.source !== "workspace-registry") {
    return;
  }
  const entry = entries.find((candidate) => candidate.id === source.id);
  if (!entry) {
    return;
  }
  entry.lastCheckedAt = update.checkedAt;
  entry.lastSyncedAt = update.syncedAt ?? entry.lastSyncedAt;
  entry.lastStatusCode = update.statusCode;
  entry.lastItemCount = update.itemCount;
  entry.lastError = update.error;
  entry.updatedAt = update.checkedAt;
  entry.contentHash = modelImageRemoteRegistryEntryContentHash(entry);
}

function registryHostFromImageTag(tag: string): string | null {
  const firstSegment = tag.split("/")[0] ?? "";
  if (firstSegment.includes(".") || firstSegment.includes(":") || firstSegment === "localhost") {
    return firstSegment;
  }
  return null;
}

function versionFromImageTag(tag: string): string | null {
  const lastSegment = tag.split("/").at(-1) ?? tag;
  const index = lastSegment.lastIndexOf(":");
  return index > 0 ? lastSegment.slice(index + 1) : "latest";
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredText(value: unknown, name: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new WorkspaceError(`${name} é obrigatório no catálogo de imagens.`, 422, value);
  }
  return normalized;
}

function optionalTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
