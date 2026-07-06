import {
  createHash,
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
  timingSafeEqual,
  type JsonWebKey,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceError } from "./workspace.ts";

type BuilderAuthRole = "owner" | "operator" | "reviewer" | "viewer";

export interface BuilderAuthIdentity {
  keyId: string;
  actorId: string;
  name: string;
  role: string;
  groups: string[];
  areas: string[];
  scopes: string[];
  source: string;
  expiresAt: string | null;
}

export interface BuilderAuthInventoryKey {
  keyId: string;
  actorId: string;
  name: string;
  role: string;
  groups: string[];
  areas: string[];
  scopes: string[];
  source: string;
  disabled: boolean;
  expired: boolean;
  expiresAt: string | null;
  hashPrefix: string;
}

export interface BuilderAuthStatus {
  enabled: boolean;
  required: boolean;
  keyCount: number;
  activeKeyCount: number;
  keys: BuilderAuthInventoryKey[];
  jwt: {
    configured: boolean;
    algorithms: string[];
    issuerConfigured: boolean;
    audienceConfigured: boolean;
    jwks: {
      configured: boolean;
      pathConfigured: boolean;
      urlConfigured: boolean;
      keyCount: number;
      cacheSeconds: number;
      storesPublicKeysOnly: true;
    };
    oidc: {
      configured: boolean;
      issuerConfigured: boolean;
      discoveryUrlConfigured: boolean;
      discoveredJwks: boolean;
      loginConfigured: boolean;
      logoutConfigured: boolean;
      authorizationEndpointConfigured: boolean;
      tokenEndpointConfigured: boolean;
      endSessionEndpointConfigured: boolean;
      redirectUriConfigured: boolean;
      postLogoutRedirectUriConfigured: boolean;
      logoutCallbackSupported: boolean;
      sessionIdTokenHintSupported: boolean;
      sessionRefreshSupported: boolean;
      usesDiscoveryCache: true;
    };
    actorClaim: string;
    roleClaim: string;
    groupsClaim: string;
    areasClaim: string;
    scopesClaim: string;
    acceptsBearer: true;
    storesJwtSecrets: false;
  };
  rotation: {
    fileConfigured: boolean;
    canWriteFile: boolean;
    storesKeyHashes: true;
    returnsRawKeyOnce: true;
  };
  sessions: {
    ttlSeconds: number;
    persistent: boolean;
    pathConfigured: boolean;
    centralLocalStore: boolean;
    externalServiceConfigured: boolean;
    externalServiceUrlConfigured: boolean;
    externalServiceTokenConfigured: boolean;
    externalServiceTimeoutMs: number;
    externalServiceInvalidReason: string | null;
    centralIntrospectionConfigured: boolean;
    centralIntrospectionRequired: boolean;
    centralIntrospectionUrlConfigured: boolean;
    centralIntrospectionTokenConfigured: boolean;
    centralIntrospectionTimeoutMs: number;
    centralIntrospectionInvalidReason: string | null;
    storesTokenHashes: true;
    storesRawTokens: false;
    storesProviderTokens: false;
    externalServiceSendsTokenHashes: true;
    externalServiceSendsRawTokens: false;
    externalServiceNonBlocking: true;
    centralIntrospectionSendsTokenHashes: true;
    centralIntrospectionSendsRawTokens: false;
    centralIntrospectionEnforcesCentralDecision: boolean;
    centralIntrospectionFailClosed: boolean;
  };
  audit: {
    persistent: boolean;
    pathConfigured: boolean;
    externalSinkConfigured: boolean;
    externalSinkUrlConfigured: boolean;
    externalSinkTokenConfigured: boolean;
    externalSinkTimeoutMs: number;
    externalSinkInvalidReason: string | null;
    sendsRawKeyValues: false;
    sendsHeaders: false;
    nonBlocking: true;
  };
  groupPolicies: {
    configured: boolean;
    pathConfigured: boolean;
    policyCount: number;
    groups: string[];
    governance: {
      excludesRawTokens: true;
      excludesSecretValues: true;
      localOnly: true;
    };
  };
  groupDirectory: {
    configured: boolean;
    pathConfigured: boolean;
    externalConfigured: boolean;
    externalUrlConfigured: boolean;
    externalTokenConfigured: boolean;
    externalTimeoutMs: number;
    externalInvalidReason: string | null;
    actorCount: number;
    groupCount: number;
    groups: string[];
    governance: {
      excludesRawTokens: true;
      excludesSecretValues: true;
      enrichesIdentityGroups: true;
      externalSendsActorSecrets: false;
      localOnly: boolean;
    };
  };
  governance: {
    excludesRawKeyValues: true;
    excludesJwtSecrets: true;
    localOnly: true;
  };
}

type BuilderAuthExternalProbeComponentId =
  | "session_service"
  | "session_introspection"
  | "audit_sink"
  | "group_directory";

type BuilderAuthExternalProbeStatus = "not_configured" | "invalid_config" | "ok" | "warning" | "error";

export interface BuilderAuthExternalProbeComponent {
  id: BuilderAuthExternalProbeComponentId;
  label: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  status: BuilderAuthExternalProbeStatus;
  statusCode: number | null;
  reason: string;
  actorCount?: number;
  groupCount?: number;
  governance: {
    excludesUrls: true;
    excludesSecretValues: true;
    sendsAuthTokenInHeaderOnly: true;
    sendsAuthTokenInBody: false;
    sendsRawKeyValues: false;
    sendsSessionTokens: false;
    sendsProviderTokens: false;
    usesSideEffectFreeProbe: boolean;
  };
}

export interface BuilderAuthExternalProbeResult {
  format: "agent-flow-builder.builder-auth-external-probe.v1";
  generatedAt: string;
  configuredCount: number;
  checkedCount: number;
  okCount: number;
  warningCount: number;
  errorCount: number;
  components: BuilderAuthExternalProbeComponent[];
  governance: {
    excludesUrls: true;
    excludesSecretValues: true;
    excludesRawKeyValues: true;
    excludesHeaders: true;
    excludesSessionTokens: true;
    excludesProviderTokens: true;
    authTokensInHeaderOnly: true;
    authTokensInBody: false;
    usesSideEffectFreeProbe: true;
  };
}

export type BuilderAuthCorporateHomologationStatus = "blocked" | "verified" | "homologated";

export interface BuilderAuthCorporateHomologationResult {
  format: "agent-flow-builder.builder-auth-corporate-homologation.v1";
  generatedAt: string;
  status: BuilderAuthCorporateHomologationStatus;
  homologationLevel: "none" | "partial_external_probe" | "full_external_probe";
  requiredComponentCount: number;
  configuredCount: number;
  checkedCount: number;
  okCount: number;
  warningCount: number;
  errorCount: number;
  missingEvidence: string[];
  artifact: {
    saved: boolean;
    relativePath: string | null;
  };
  statusSnapshot: {
    authRequired: boolean;
    activeKeyCount: number;
    jwtConfigured: boolean;
    oidcConfigured: boolean;
    centralLocalSessionStore: boolean;
    sessionServiceConfigured: boolean;
    centralIntrospectionConfigured: boolean;
    centralIntrospectionRequired: boolean;
    auditSinkConfigured: boolean;
    groupDirectoryExternalConfigured: boolean;
    groupPoliciesConfigured: boolean;
  };
  components: BuilderAuthExternalProbeComponent[];
  governance: {
    excludesUrls: true;
    excludesSecretValues: true;
    excludesRawKeyValues: true;
    excludesHeaders: true;
    excludesSessionTokens: true;
    excludesProviderTokens: true;
    excludesResolvedLocalPaths: true;
    storesHomologationArtifactLocally: boolean;
    authTokensInHeaderOnly: true;
    authTokensInBody: false;
    usesSideEffectFreeProbe: true;
  };
}

export interface BuilderAuthSessionResult {
  format: "agent-flow-builder.builder-auth-session.v1";
  generatedAt: string;
  token: string;
  expiresAt: string;
  ttlSeconds: number;
  identity: BuilderAuthIdentity;
  governance: {
    storesRawToken: false;
    storesTokenHash: true;
    returnsRawTokenOnce: true;
    storesProviderLogoutHint: boolean;
    storesProviderRefreshToken: boolean;
    returnsProviderTokens: false;
    localOnly: true;
  };
}

export interface BuilderAuthSessionLogoutResult {
  format: "agent-flow-builder.builder-auth-session-logout.v1";
  generatedAt: string;
  revoked: boolean;
  identity: BuilderAuthIdentity | null;
  governance: {
    storesRawToken: false;
    storesTokenHash: true;
    returnsRawToken: false;
    removesProviderLogoutHint: true;
    removesProviderRefreshToken: true;
    localOnly: true;
  };
}

export interface BuilderAuthOidcLoginResult {
  format: "agent-flow-builder.builder-auth-oidc-login.v1";
  generatedAt: string;
  authorizationUrl: string;
  state: string;
  expiresAt: string;
  issuer: string | null;
  authorizationEndpoint: string;
  redirectUri: string;
  scopes: string[];
  governance: {
    usesPkce: true;
    storesStateHash: true;
    storesNonceHash: true;
    storesProviderTokens: false;
    localOnly: true;
  };
}

export interface BuilderAuthOidcLogoutResult {
  format: "agent-flow-builder.builder-auth-oidc-logout.v1";
  generatedAt: string;
  logoutUrl: string;
  state: string;
  expiresAt: string;
  issuer: string | null;
  endSessionEndpoint: string;
  postLogoutRedirectUri: string | null;
  governance: {
    storesStateHash: true;
    storesProviderTokens: "id_token_hint_session_memory_only" | false;
    sendsIdTokenHint: boolean;
    validatesCallbackState: true;
    returnsProviderTokens: false;
    returnsIdTokenHintInLogoutUrl: boolean;
    localOnly: true;
  };
}

export interface BuilderAuthOidcLogoutCallbackResult {
  format: "agent-flow-builder.builder-auth-oidc-logout-callback.v1";
  generatedAt: string;
  state: string;
  issuer: string | null;
  postLogoutRedirectUri: string | null;
  identity: BuilderAuthIdentity | null;
  governance: {
    validatesState: true;
    returnsProviderTokens: false;
    localOnly: true;
  };
}

export interface BuilderAuthOidcCallbackResult {
  format: "agent-flow-builder.builder-auth-oidc-callback.v1";
  generatedAt: string;
  session: BuilderAuthSessionResult;
  identity: BuilderAuthIdentity;
  governance: {
    validatesState: true;
    validatesNonce: true;
    validatesIdTokenSignature: true;
    storesProviderTokens: "id_token_hint_session_memory_only" | "id_token_hint_and_refresh_token_session_memory_only";
    storesProviderLogoutHint: true;
    storesProviderRefreshToken: boolean;
    returnsProviderTokens: false;
    localOnly: true;
  };
}

export type BuilderAuthAuditStatus = "allowed" | "missing" | "rejected";

export interface BuilderAuthAuditReportOptions {
  limit?: number;
  status?: BuilderAuthAuditStatus;
  method?: string;
  route?: string;
  keyId?: string;
  actorId?: string;
  q?: string;
  from?: string;
  to?: string;
}

export interface BuilderAuthAuditEntry {
  seq: number;
  at: string;
  status: BuilderAuthAuditStatus;
  method: string;
  route: string;
  keyId: string | null;
  actorId: string | null;
  source: string | null;
  reason: string | null;
}

export interface BuilderAuthAuditCounter {
  id: string;
  count: number;
  allowed: number;
  missing: number;
  rejected: number;
}

export interface BuilderAuthAuditReport {
  format: "agent-flow-builder.builder-auth-audit.v1";
  generatedAt: string;
  total: number;
  filteredTotal: number;
  query: {
    limit: number;
    status: BuilderAuthAuditStatus | null;
    method: string | null;
    route: string | null;
    keyId: string | null;
    actorId: string | null;
    q: string | null;
    from: string | null;
    to: string | null;
  };
  summary: {
    returnedCount: number;
    statusCounts: Record<BuilderAuthAuditStatus, number>;
    uniqueActorCount: number;
    uniqueKeyCount: number;
    topActors: BuilderAuthAuditCounter[];
    topKeys: BuilderAuthAuditCounter[];
    topRoutes: BuilderAuthAuditCounter[];
    earliestAt: string | null;
    latestAt: string | null;
  };
  entries: BuilderAuthAuditEntry[];
  governance: {
    excludesRawKeyValues: true;
    excludesHeaders: true;
    localOnly: boolean;
    persistent: boolean;
    pathConfigured: boolean;
    externalSinkConfigured: boolean;
    externalSinkNonBlocking: true;
    externalSinkSendsRawKeyValues: false;
    externalSinkSendsHeaders: false;
    loadedFromPersistentStore: boolean;
    persistentEntryCount: number;
    malformedPersistentLineCount: number;
  };
}

export interface BuilderAuthAuditSinkEvent {
  format: "agent-flow-builder.builder-auth-audit-sink-event.v1";
  generatedAt: string;
  entry: BuilderAuthAuditEntry;
  governance: {
    excludesRawKeyValues: true;
    excludesHeaders: true;
    excludesSessionTokens: true;
    sinkAuthTokenInBody: false;
  };
}

export interface BuilderAuthAuditStore {
  record(input: {
    result: BuilderAuthResult;
    method: string;
    route: string;
  }): Promise<void>;
  report(input?: number | BuilderAuthAuditReportOptions): Promise<BuilderAuthAuditReport>;
}

export interface BuilderAuthSessionStore {
  create(identity: BuilderAuthIdentity, options?: BuilderAuthSessionCreateOptions): BuilderAuthSessionResult;
  authenticate(token: string): Promise<BuilderAuthResult>;
  refresh(token: string): BuilderAuthSessionResult;
  refreshWithIdentity(token: string, identity: BuilderAuthIdentity, options?: BuilderAuthSessionCreateOptions): BuilderAuthSessionResult;
  revoke(token: string): BuilderAuthSessionLogoutResult;
  oidcLogoutHint(token: string): BuilderAuthOidcSessionLogoutHint | null;
  oidcRefreshToken(token: string): BuilderAuthOidcSessionRefreshToken | null;
  activeCount(): number;
}

export interface BuilderAuthOidcFlowStore {
  create(input: BuilderAuthOidcLoginConfig): BuilderAuthOidcLoginResult;
  consume(state: string): BuilderAuthOidcPendingFlow | null;
}

export interface BuilderAuthOidcLogoutFlowStore {
  create(input: BuilderAuthOidcLoginConfig, options?: BuilderAuthOidcLogoutFlowOptions): BuilderAuthOidcLogoutResult;
  consume(state: string): BuilderAuthOidcPendingLogoutFlow | null;
}

export interface BuilderAuthKeyRotationResult {
  format: "agent-flow-builder.builder-auth-key-rotation.v1";
  generatedAt: string;
  keyValue: string;
  key: BuilderAuthInventoryKey;
  status: BuilderAuthStatus;
  governance: {
    storesRawKeyValue: false;
    storesKeyHash: true;
    returnsRawKeyValueOnce: true;
    excludesExistingRawKeyValues: true;
    localOnly: true;
  };
}

export type BuilderAuthResult =
  | { status: "disabled"; identity: null; reason: null }
  | { status: "authenticated"; identity: BuilderAuthIdentity; reason: null }
  | { status: "missing"; identity: null; reason: string }
  | { status: "rejected"; identity: null; reason: string };

interface BuilderAuthKey {
  keyId: string;
  actorId: string;
  name: string;
  role: string;
  groups: string[];
  areas: string[];
  scopes: string[];
  source: string;
  disabled: boolean;
  expiresAt: string | null;
  keyHash: string;
}

interface BuilderAuthConfig {
  required: boolean;
  keys: BuilderAuthKey[];
  jwt: BuilderAuthJwtConfig;
  groupDirectory: BuilderAuthGroupDirectory;
  groupPolicies: BuilderAuthGroupPolicy[];
}

interface BuilderAuthGroupDirectory {
  actors: BuilderAuthGroupDirectoryActor[];
  groups: BuilderAuthGroupDirectoryGroup[];
}

interface BuilderAuthGroupDirectoryActor {
  actorId: string;
  groups: string[];
  source: string;
}

interface BuilderAuthGroupDirectoryGroup {
  group: string;
  members: string[];
  source: string;
}

interface BuilderAuthExternalGroupDirectoryConfig {
  configured: boolean;
  urlConfigured: boolean;
  url: string;
  token: string;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
}

interface BuilderAuthGroupPolicy {
  group: string;
  role: BuilderAuthRole | null;
  areas: string[];
  scopes: string[];
  source: string;
}

type HeaderBag = Record<string, string | string[] | undefined>;

interface BuilderAuthJwtConfig {
  configured: boolean;
  secret: string;
  publicKey: string;
  jwksKeys: BuilderAuthJwksKey[];
  jwksPathConfigured: boolean;
  jwksUrlConfigured: boolean;
  oidcConfigured: boolean;
  oidcIssuerUrlConfigured: boolean;
  oidcDiscoveryUrlConfigured: boolean;
  oidcDiscoveredJwks: boolean;
  oidcLogin: BuilderAuthOidcLoginConfig;
  jwksCacheSeconds: number;
  algorithms: string[];
  issuer: string[];
  audience: string[];
  actorClaims: string[];
  nameClaims: string[];
  roleClaims: string[];
  groupsClaims: string[];
  areasClaims: string[];
  scopesClaims: string[];
  clockToleranceSeconds: number;
}

interface BuilderAuthJwksKey {
  kid: string | null;
  alg: string | null;
  publicKey: string;
  source: string;
}

interface BuilderAuthOidcLoginConfig {
  configured: boolean;
  logoutConfigured: boolean;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  endSessionEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scopes: string[];
  flowTtlSeconds: number;
}

interface BuilderAuthOidcPendingFlow {
  stateHash: string;
  nonceHash: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  expiresAt: string;
}

interface BuilderAuthSessionCreateOptions {
  oidcIdTokenHint?: string | null;
  oidcRefreshToken?: string | null;
}

interface BuilderAuthSessionRecord {
  identity: BuilderAuthIdentity;
  expiresAt: string;
  oidcIdTokenHint: string | null;
  oidcRefreshToken: string | null;
}

interface BuilderAuthPersistentSessionRecord {
  tokenHash: string;
  identity: BuilderAuthIdentity;
  expiresAt: string;
  createdAt: string;
  hasProviderLogoutHint: boolean;
  hasProviderRefreshToken: boolean;
}

type BuilderAuthSessionServiceAction = "created" | "refreshed" | "revoked";

interface BuilderAuthSessionServiceConfig {
  configured: boolean;
  urlConfigured: boolean;
  url: string;
  token: string;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
}

interface BuilderAuthSessionServiceEvent {
  format: "agent-flow-builder.builder-auth-session-service-event.v1";
  generatedAt: string;
  action: BuilderAuthSessionServiceAction;
  session: {
    tokenHash: string;
    previousTokenHash: string | null;
    identity: BuilderAuthIdentity | null;
    expiresAt: string | null;
    ttlSeconds: number;
    revoked: boolean | null;
    hasProviderLogoutHint: boolean;
    hasProviderRefreshToken: boolean;
  };
  governance: {
    sendsTokenHash: true;
    sendsRawToken: false;
    sendsProviderTokens: false;
    sendsRawKeyValues: false;
    serviceAuthTokenInBody: false;
  };
}

interface BuilderAuthSessionIntrospectionConfig {
  configured: boolean;
  urlConfigured: boolean;
  url: string;
  token: string;
  tokenConfigured: boolean;
  timeoutMs: number;
  required: boolean;
  invalidReason: string | null;
}

interface BuilderAuthSessionIntrospectionRequest {
  format: "agent-flow-builder.builder-auth-session-introspection-request.v1";
  generatedAt: string;
  session: {
    tokenHash: string;
    localIdentity: BuilderAuthIdentity;
    localExpiresAt: string;
    hasLocalSession: true;
    hasProviderLogoutHint: boolean;
    hasProviderRefreshToken: boolean;
  };
  governance: {
    sendsTokenHash: true;
    sendsRawToken: false;
    sendsProviderTokens: false;
    sendsRawKeyValues: false;
    serviceAuthTokenInBody: false;
    centralDecisionCanOverrideIdentity: true;
  };
}

type BuilderAuthSessionIntrospectionDecision =
  | { status: "skipped" }
  | { status: "authenticated"; identity: BuilderAuthIdentity }
  | { status: "rejected"; reason: string };

interface BuilderAuthAuditSinkConfig {
  configured: boolean;
  urlConfigured: boolean;
  url: string;
  token: string;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
}

interface BuilderAuthOidcSessionLogoutHint {
  idTokenHint: string | null;
  identity: BuilderAuthIdentity;
}

interface BuilderAuthOidcSessionRefreshToken {
  refreshToken: string;
  identity: BuilderAuthIdentity;
}

interface BuilderAuthOidcLogoutFlowOptions {
  idTokenHint?: string | null;
  identity?: BuilderAuthIdentity | null;
}

interface BuilderAuthOidcPendingLogoutFlow {
  stateHash: string;
  expiresAt: string;
  issuer: string | null;
  postLogoutRedirectUri: string | null;
  sentIdTokenHint: boolean;
  identity: BuilderAuthIdentity | null;
}

interface BuilderAuthOidcTokenResponse {
  idToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
}

interface JwtTokenParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
}

export function createBuilderAuthAuditStore(env: NodeJS.ProcessEnv = process.env): BuilderAuthAuditStore {
  const entries: BuilderAuthAuditEntry[] = [];
  const auditPath = env.AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH?.trim() || "";
  const auditSink = builderAuthAuditSinkConfig(env);
  let seq = 0;
  let persistentLoaded = false;
  let persistentEntryCount = 0;
  let malformedPersistentLineCount = 0;
  let persistentLoadPromise: Promise<void> | null = null;

  async function ensurePersistentAuditLoaded(): Promise<void> {
    if (!auditPath || persistentLoaded) {
      return;
    }
    persistentLoadPromise ??= loadPersistentAuditEntries(auditPath)
      .then((result) => {
        entries.splice(0, entries.length, ...result.entries.slice(-1000));
        seq = Math.max(seq, ...entries.map((entry) => entry.seq), 0);
        persistentEntryCount = result.entries.length;
        malformedPersistentLineCount = result.malformedLineCount;
        persistentLoaded = true;
      })
      .catch(() => {
        // Auth must keep working even if the optional local audit file is unreadable.
        persistentLoaded = true;
      });
    await persistentLoadPromise;
  }

  return {
    async record(input) {
      const result = input.result;
      if (result.status === "disabled") {
        return;
      }
      await ensurePersistentAuditLoaded();
      const entry = toAuditEntry(++seq, { ...input, result });
      entries.push(entry);
      if (entries.length > 1000) {
        entries.splice(0, entries.length - 1000);
      }
      void sendBuilderAuthAuditSinkEvent(entry, auditSink);
      if (auditPath) {
        try {
          await mkdir(path.dirname(auditPath), { recursive: true });
          await appendFile(auditPath, `${JSON.stringify(entry)}\n`, "utf-8");
        } catch {
          // Auth must not fail just because the optional local audit sink is unavailable.
        }
      }
    },
    async report(input: number | BuilderAuthAuditReportOptions = 100) {
      await ensurePersistentAuditLoaded();
      const options = typeof input === "number" ? { limit: input } : input;
      const safeLimit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
      const normalizedOptions = normalizeAuditReportOptions({ ...options, limit: safeLimit });
      const filteredEntries = entries.filter((entry) => auditEntryMatches(entry, normalizedOptions));
      const returnedEntries = filteredEntries.slice(-safeLimit).reverse();
      return {
        format: "agent-flow-builder.builder-auth-audit.v1",
        generatedAt: new Date().toISOString(),
        total: entries.length,
        filteredTotal: filteredEntries.length,
        query: {
          limit: safeLimit,
          status: normalizedOptions.status ?? null,
          method: normalizedOptions.method ?? null,
          route: normalizedOptions.route ?? null,
          keyId: normalizedOptions.keyId ?? null,
          actorId: normalizedOptions.actorId ?? null,
          q: normalizedOptions.q ?? null,
          from: normalizedOptions.from ?? null,
          to: normalizedOptions.to ?? null,
        },
        summary: buildAuditSummary(filteredEntries, returnedEntries),
        entries: returnedEntries,
        governance: {
          excludesRawKeyValues: true,
          excludesHeaders: true,
          localOnly: !auditSink.configured,
          persistent: Boolean(auditPath),
          pathConfigured: Boolean(auditPath),
          externalSinkConfigured: auditSink.configured,
          externalSinkNonBlocking: true,
          externalSinkSendsRawKeyValues: false,
          externalSinkSendsHeaders: false,
          loadedFromPersistentStore: persistentLoaded,
          persistentEntryCount,
          malformedPersistentLineCount,
        },
      };
    },
  };
}

export function createBuilderAuthSessionStore(env: NodeJS.ProcessEnv = process.env): BuilderAuthSessionStore {
  const sessions = new Map<string, BuilderAuthSessionRecord>();
  const ttlSeconds = builderAuthSessionTtlSeconds(env);
  const sessionPath = builderAuthSessionPersistencePath(env);
  const sessionService = builderAuthSessionServiceConfig(env);
  const sessionIntrospection = builderAuthSessionIntrospectionConfig(env);
  let persistentLoaded = false;

  function ensurePersistentSessionsLoaded(): void {
    if (!sessionPath || persistentLoaded) {
      return;
    }
    persistentLoaded = true;
    const loaded = loadPersistentBuilderAuthSessions(sessionPath);
    for (const item of loaded) {
      sessions.set(item.tokenHash, {
        identity: {
          ...item.identity,
          source: "session",
        },
        expiresAt: item.expiresAt,
        oidcIdTokenHint: null,
        oidcRefreshToken: null,
      });
    }
    pruneExpiredSessions(sessions);
    persistSessions();
  }

  function persistSessions(): void {
    if (!sessionPath) {
      return;
    }
    try {
      mkdirSync(path.dirname(sessionPath), { recursive: true });
      const records: BuilderAuthPersistentSessionRecord[] = Array.from(sessions.entries()).map(([tokenHash, session]) => ({
        tokenHash,
        identity: sanitizePersistentBuilderAuthSessionIdentity(session.identity, session.expiresAt),
        expiresAt: session.expiresAt,
        createdAt: new Date().toISOString(),
        hasProviderLogoutHint: Boolean(session.oidcIdTokenHint),
        hasProviderRefreshToken: Boolean(session.oidcRefreshToken),
      }));
      writeFileSync(sessionPath, JSON.stringify({
        format: "agent-flow-builder.builder-auth-sessions.v1",
        generatedAt: new Date().toISOString(),
        sessions: records,
        governance: {
          storesRawTokens: false,
          storesTokenHashes: true,
          storesProviderTokens: false,
          localOnly: true,
        },
      }, null, 2), "utf-8");
    } catch {
      // Session persistence is optional; auth must keep working in memory if the file is unavailable.
    }
  }

  function createSession(
    identity: BuilderAuthIdentity,
    options: BuilderAuthSessionCreateOptions = {},
    sync: { action: Exclude<BuilderAuthSessionServiceAction, "revoked">; previousTokenHash?: string | null } = { action: "created" },
  ): BuilderAuthSessionResult {
    ensurePersistentSessionsLoaded();
    pruneExpiredSessions(sessions);
    const token = `afbs_${randomBytes(32).toString("base64url")}`;
    const tokenHash = hashKey(token);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const oidcIdTokenHint = options.oidcIdTokenHint?.trim() || null;
    const oidcRefreshToken = options.oidcRefreshToken?.trim() || null;
    const sessionRecord: BuilderAuthSessionRecord = {
      identity: {
        ...identity,
        source: "session",
      },
      expiresAt,
      oidcIdTokenHint,
      oidcRefreshToken,
    };
    sessions.set(tokenHash, sessionRecord);
    persistSessions();
    void sendBuilderAuthSessionServiceEvent({
      config: sessionService,
      action: sync.action,
      tokenHash,
      previousTokenHash: sync.previousTokenHash ?? null,
      session: sessionRecord,
      ttlSeconds,
      revoked: null,
    });
    return {
      format: "agent-flow-builder.builder-auth-session.v1",
      generatedAt: new Date().toISOString(),
      token,
      expiresAt,
      ttlSeconds,
      identity,
      governance: {
        storesRawToken: false,
        storesTokenHash: true,
        returnsRawTokenOnce: true,
        storesProviderLogoutHint: Boolean(oidcIdTokenHint),
        storesProviderRefreshToken: Boolean(oidcRefreshToken),
        returnsProviderTokens: false,
        localOnly: true,
      },
    };
  }

  return {
    create(identity, options) {
      return createSession(identity, options);
    },
    async authenticate(token) {
      ensurePersistentSessionsLoaded();
      pruneExpiredSessions(sessions);
      persistSessions();
      const tokenHash = hashKey(token);
      const session = sessions.get(tokenHash);
      if (!session) {
        return { status: "rejected", identity: null, reason: "Sessão local do Builder inválida ou expirada." };
      }
      const centralDecision = await introspectBuilderAuthSession({
        config: sessionIntrospection,
        tokenHash,
        session,
      });
      if (centralDecision.status === "rejected") {
        return { status: "rejected", identity: null, reason: centralDecision.reason };
      }
      if (centralDecision.status === "authenticated") {
        return {
          status: "authenticated",
          identity: centralDecision.identity,
          reason: null,
        };
      }
      return {
        status: "authenticated",
        identity: {
          ...session.identity,
          expiresAt: session.expiresAt,
        },
        reason: null,
      };
    },
    refresh(token) {
      ensurePersistentSessionsLoaded();
      pruneExpiredSessions(sessions);
      const sessionHash = hashKey(token);
      const session = sessions.get(sessionHash);
      if (!session) {
        throw new WorkspaceError("Sessão local do Builder inválida ou expirada.", 401);
      }
      sessions.delete(sessionHash);
      return createSession(session.identity, {
        oidcIdTokenHint: session.oidcIdTokenHint,
        oidcRefreshToken: session.oidcRefreshToken,
      }, { action: "refreshed", previousTokenHash: sessionHash });
    },
    refreshWithIdentity(token, identity, options = {}) {
      ensurePersistentSessionsLoaded();
      pruneExpiredSessions(sessions);
      const sessionHash = hashKey(token);
      const session = sessions.get(sessionHash);
      if (!session) {
        throw new WorkspaceError("Sessão local do Builder inválida ou expirada.", 401);
      }
      sessions.delete(sessionHash);
      return createSession(identity, options, { action: "refreshed", previousTokenHash: sessionHash });
    },
    revoke(token) {
      ensurePersistentSessionsLoaded();
      pruneExpiredSessions(sessions);
      const sessionHash = hashKey(token);
      const session = sessions.get(sessionHash) ?? null;
      const revoked = sessions.delete(sessionHash);
      persistSessions();
      void sendBuilderAuthSessionServiceEvent({
        config: sessionService,
        action: "revoked",
        tokenHash: sessionHash,
        previousTokenHash: null,
        session,
        ttlSeconds,
        revoked,
      });
      return {
        format: "agent-flow-builder.builder-auth-session-logout.v1",
        generatedAt: new Date().toISOString(),
        revoked,
        identity: session?.identity ?? null,
        governance: {
          storesRawToken: false,
          storesTokenHash: true,
          returnsRawToken: false,
          removesProviderLogoutHint: true,
          removesProviderRefreshToken: true,
          localOnly: true,
        },
      };
    },
    oidcLogoutHint(token) {
      ensurePersistentSessionsLoaded();
      pruneExpiredSessions(sessions);
      const session = sessions.get(hashKey(token)) ?? null;
      if (!session) {
        return null;
      }
      return {
        idTokenHint: session.oidcIdTokenHint,
        identity: {
          ...session.identity,
          expiresAt: session.expiresAt,
        },
      };
    },
    oidcRefreshToken(token) {
      ensurePersistentSessionsLoaded();
      pruneExpiredSessions(sessions);
      const session = sessions.get(hashKey(token)) ?? null;
      if (!session?.oidcRefreshToken) {
        return null;
      }
      return {
        refreshToken: session.oidcRefreshToken,
        identity: {
          ...session.identity,
          expiresAt: session.expiresAt,
        },
      };
    },
    activeCount() {
      ensurePersistentSessionsLoaded();
      pruneExpiredSessions(sessions);
      persistSessions();
      return sessions.size;
    },
  };
}

export function createBuilderAuthOidcFlowStore(): BuilderAuthOidcFlowStore {
  const pending = new Map<string, BuilderAuthOidcPendingFlow>();
  return {
    create(input) {
      pruneExpiredOidcFlows(pending);
      if (!input.configured) {
        throw new WorkspaceError("Login OIDC do Builder não está configurado.", 400);
      }
      const state = randomBytes(24).toString("base64url");
      const nonce = randomBytes(24).toString("base64url");
      const codeVerifier = randomBytes(48).toString("base64url");
      const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
      const expiresAt = new Date(Date.now() + input.flowTtlSeconds * 1000).toISOString();
      pending.set(hashKey(state), {
        stateHash: hashKey(state),
        nonceHash: hashKey(nonce),
        codeVerifier,
        redirectUri: input.redirectUri,
        clientId: input.clientId,
        expiresAt,
      });
      const authorizationUrl = new URL(input.authorizationEndpoint);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("client_id", input.clientId);
      authorizationUrl.searchParams.set("redirect_uri", input.redirectUri);
      authorizationUrl.searchParams.set("scope", input.scopes.join(" "));
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("nonce", nonce);
      authorizationUrl.searchParams.set("code_challenge", codeChallenge);
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      return {
        format: "agent-flow-builder.builder-auth-oidc-login.v1",
        generatedAt: new Date().toISOString(),
        authorizationUrl: authorizationUrl.toString(),
        state,
        expiresAt,
        issuer: input.issuer || null,
        authorizationEndpoint: input.authorizationEndpoint,
        redirectUri: input.redirectUri,
        scopes: input.scopes,
        governance: {
          usesPkce: true,
          storesStateHash: true,
          storesNonceHash: true,
          storesProviderTokens: false,
          localOnly: true,
        },
      };
    },
    consume(state) {
      pruneExpiredOidcFlows(pending);
      const stateHash = hashKey(state);
      const flow = pending.get(stateHash) ?? null;
      if (flow) {
        pending.delete(stateHash);
      }
      return flow;
    },
  };
}

export function createBuilderAuthOidcLogoutFlowStore(): BuilderAuthOidcLogoutFlowStore {
  const pending = new Map<string, BuilderAuthOidcPendingLogoutFlow>();
  return {
    create(input, options = {}) {
      pruneExpiredOidcFlows(pending);
      if (!input.logoutConfigured) {
        throw new WorkspaceError("Logout federado OIDC do Builder não está configurado.", 400);
      }
      const state = randomBytes(24).toString("base64url");
      const expiresAt = new Date(Date.now() + input.flowTtlSeconds * 1000).toISOString();
      const idTokenHint = options.idTokenHint?.trim() || "";
      pending.set(hashKey(state), {
        stateHash: hashKey(state),
        expiresAt,
        issuer: input.issuer || null,
        postLogoutRedirectUri: input.postLogoutRedirectUri || null,
        sentIdTokenHint: Boolean(idTokenHint),
        identity: options.identity ?? null,
      });
      const logoutUrl = new URL(input.endSessionEndpoint);
      logoutUrl.searchParams.set("client_id", input.clientId);
      logoutUrl.searchParams.set("state", state);
      if (input.postLogoutRedirectUri) {
        logoutUrl.searchParams.set("post_logout_redirect_uri", input.postLogoutRedirectUri);
      }
      if (idTokenHint) {
        logoutUrl.searchParams.set("id_token_hint", idTokenHint);
      }
      return {
        format: "agent-flow-builder.builder-auth-oidc-logout.v1",
        generatedAt: new Date().toISOString(),
        logoutUrl: logoutUrl.toString(),
        state,
        expiresAt,
        issuer: input.issuer || null,
        endSessionEndpoint: input.endSessionEndpoint,
        postLogoutRedirectUri: input.postLogoutRedirectUri || null,
        governance: {
          storesStateHash: true,
          storesProviderTokens: idTokenHint ? "id_token_hint_session_memory_only" : false,
          sendsIdTokenHint: Boolean(idTokenHint),
          validatesCallbackState: true,
          returnsProviderTokens: false,
          returnsIdTokenHintInLogoutUrl: Boolean(idTokenHint),
          localOnly: true,
        },
      };
    },
    consume(state) {
      pruneExpiredOidcFlows(pending);
      const stateHash = hashKey(state);
      const flow = pending.get(stateHash) ?? null;
      if (flow) {
        pending.delete(stateHash);
      }
      return flow;
    },
  };
}

export async function createBuilderAuthOidcLoginUrl(
  env: NodeJS.ProcessEnv,
  flowStore: BuilderAuthOidcFlowStore,
): Promise<BuilderAuthOidcLoginResult> {
  const config = await loadBuilderAuthConfig(env);
  return flowStore.create(config.jwt.oidcLogin);
}

export async function createBuilderAuthOidcLogoutUrl(
  env: NodeJS.ProcessEnv,
  flowStore: BuilderAuthOidcLogoutFlowStore,
  options: {
    sessionStore?: BuilderAuthSessionStore;
    sessionToken?: string;
  } = {},
): Promise<BuilderAuthOidcLogoutResult> {
  const config = await loadBuilderAuthConfig(env);
  const oidc = config.jwt.oidcLogin;
  const hint = options.sessionStore && options.sessionToken
    ? options.sessionStore.oidcLogoutHint(options.sessionToken)
    : null;
  return flowStore.create(oidc, {
    idTokenHint: hint?.idTokenHint ?? null,
    identity: hint?.identity ?? null,
  });
}

export async function completeBuilderAuthOidcLogoutCallback(
  query: unknown,
  flowStore: BuilderAuthOidcLogoutFlowStore,
): Promise<BuilderAuthOidcLogoutCallbackResult> {
  const payload = isRecord(query) ? query : {};
  const state = typeof payload.state === "string" ? payload.state.trim() : "";
  const error = typeof payload.error === "string" ? payload.error.trim() : "";
  if (error) {
    throw new WorkspaceError(`Logout OIDC rejeitado pelo provedor: ${error}`, 403);
  }
  if (!state) {
    throw new WorkspaceError("Callback de logout OIDC do Builder requer state.", 400);
  }
  const pending = flowStore.consume(state);
  if (!pending) {
    throw new WorkspaceError("State de logout OIDC do Builder inválido ou expirado.", 403);
  }
  return {
    format: "agent-flow-builder.builder-auth-oidc-logout-callback.v1",
    generatedAt: new Date().toISOString(),
    state,
    issuer: pending.issuer,
    postLogoutRedirectUri: pending.postLogoutRedirectUri,
    identity: pending.identity,
    governance: {
      validatesState: true,
      returnsProviderTokens: false,
      localOnly: true,
    },
  };
}

export async function completeBuilderAuthOidcCallback(
  query: unknown,
  env: NodeJS.ProcessEnv,
  flowStore: BuilderAuthOidcFlowStore,
  sessionStore: BuilderAuthSessionStore,
): Promise<BuilderAuthOidcCallbackResult> {
  const payload = isRecord(query) ? query : {};
  const state = typeof payload.state === "string" ? payload.state.trim() : "";
  const code = typeof payload.code === "string" ? payload.code.trim() : "";
  const error = typeof payload.error === "string" ? payload.error.trim() : "";
  if (error) {
    throw new WorkspaceError(`Login OIDC rejeitado pelo provedor: ${error}`, 403);
  }
  if (!state || !code) {
    throw new WorkspaceError("Callback OIDC do Builder requer code e state.", 400);
  }
  const pending = flowStore.consume(state);
  if (!pending) {
    throw new WorkspaceError("State OIDC do Builder inválido ou expirado.", 403);
  }
  const config = await loadBuilderAuthConfig(env);
  if (!config.jwt.oidcLogin.configured) {
    throw new WorkspaceError("Login OIDC do Builder não está configurado.", 400);
  }
  const tokenResponse = await exchangeBuilderAuthOidcCode(code, pending, config.jwt.oidcLogin);
  const idToken = tokenResponse.idToken;
  if (!idToken) {
    throw new WorkspaceError("Token endpoint OIDC não retornou id_token.", 403);
  }
  const parsed = parseJwtToken(idToken);
  if (!parsed) {
    throw new WorkspaceError("id_token OIDC malformado.", 403);
  }
  validateOidcNonce(parsed.payload, pending);
  const auth = authenticateBuilderJwt(idToken, config.jwt, config.groupDirectory, config.groupPolicies);
  if (auth.status !== "authenticated") {
    throw new WorkspaceError("id_token OIDC rejeitado pela auth do Builder.", 403, {
      auth: {
        status: auth.status,
        reason: auth.reason,
      },
    });
  }
  const session = sessionStore.create(auth.identity, {
    oidcIdTokenHint: idToken,
    oidcRefreshToken: tokenResponse.refreshToken,
  });
  return {
    format: "agent-flow-builder.builder-auth-oidc-callback.v1",
    generatedAt: new Date().toISOString(),
    session,
    identity: auth.identity,
    governance: {
      validatesState: true,
      validatesNonce: true,
      validatesIdTokenSignature: true,
      storesProviderTokens: tokenResponse.refreshToken
        ? "id_token_hint_and_refresh_token_session_memory_only"
        : "id_token_hint_session_memory_only",
      storesProviderLogoutHint: true,
      storesProviderRefreshToken: Boolean(tokenResponse.refreshToken),
      returnsProviderTokens: false,
      localOnly: true,
    },
  };
}

export async function refreshBuilderAuthOidcSession(
  token: string,
  env: NodeJS.ProcessEnv,
  sessionStore: BuilderAuthSessionStore,
): Promise<BuilderAuthSessionResult> {
  const current = sessionStore.oidcRefreshToken(token);
  if (!current) {
    throw new WorkspaceError("Sessão local do Builder não possui refresh token OIDC em memória.", 400);
  }
  const config = await loadBuilderAuthConfig(env);
  if (!config.jwt.oidcLogin.configured || !config.jwt.oidcLogin.tokenEndpoint) {
    throw new WorkspaceError("Refresh OIDC do Builder não está configurado.", 400);
  }
  const tokenResponse = await exchangeBuilderAuthOidcRefreshToken(current.refreshToken, config.jwt.oidcLogin);
  const idToken = tokenResponse.idToken;
  if (!idToken) {
    throw new WorkspaceError("Token endpoint OIDC não retornou id_token no refresh.", 403);
  }
  const auth = authenticateBuilderJwt(idToken, config.jwt, config.groupDirectory, config.groupPolicies);
  if (auth.status !== "authenticated") {
    throw new WorkspaceError("id_token OIDC de refresh rejeitado pela auth do Builder.", 403, {
      auth: {
        status: auth.status,
        reason: auth.reason,
      },
    });
  }
  return sessionStore.refreshWithIdentity(token, auth.identity, {
    oidcIdTokenHint: idToken,
    oidcRefreshToken: tokenResponse.refreshToken ?? current.refreshToken,
  });
}

async function loadPersistentAuditEntries(auditPath: string): Promise<{
  entries: BuilderAuthAuditEntry[];
  malformedLineCount: number;
}> {
  let content = "";
  try {
    content = await readFile(auditPath, "utf-8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { entries: [], malformedLineCount: 0 };
    }
    throw error;
  }
  const entries: BuilderAuthAuditEntry[] = [];
  let malformedLineCount = 0;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      const entry = normalizePersistentAuditEntry(parsed);
      if (entry) {
        entries.push(entry);
      } else {
        malformedLineCount += 1;
      }
    } catch {
      malformedLineCount += 1;
    }
  }
  return { entries, malformedLineCount };
}

function normalizePersistentAuditEntry(value: unknown): BuilderAuthAuditEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const seq = typeof candidate.seq === "number" && Number.isInteger(candidate.seq) && candidate.seq > 0
    ? candidate.seq
    : null;
  const at = typeof candidate.at === "string" && !Number.isNaN(Date.parse(candidate.at))
    ? new Date(candidate.at).toISOString()
    : null;
  const status = candidate.status === "allowed" || candidate.status === "missing" || candidate.status === "rejected"
    ? candidate.status
    : null;
  const method = typeof candidate.method === "string" && candidate.method.trim()
    ? candidate.method.trim().toUpperCase()
    : null;
  const route = typeof candidate.route === "string" && candidate.route.trim()
    ? candidate.route.trim()
    : null;
  if (seq === null || at === null || status === null || method === null || route === null) {
    return null;
  }
  return {
    seq,
    at,
    status,
    method,
    route,
    keyId: typeof candidate.keyId === "string" && candidate.keyId.trim() ? candidate.keyId.trim() : null,
    actorId: typeof candidate.actorId === "string" && candidate.actorId.trim() ? candidate.actorId.trim() : null,
    source: typeof candidate.source === "string" && candidate.source.trim() ? candidate.source.trim() : null,
    reason: typeof candidate.reason === "string" && candidate.reason.trim() ? candidate.reason.trim() : null,
  };
}

function normalizeAuditReportOptions(options: BuilderAuthAuditReportOptions): BuilderAuthAuditReportOptions {
  return {
    ...options,
    method: normalizeOptionalAuditText(options.method)?.toUpperCase(),
    route: normalizeOptionalAuditText(options.route),
    keyId: normalizeOptionalAuditText(options.keyId),
    actorId: normalizeOptionalAuditText(options.actorId),
    q: normalizeOptionalAuditText(options.q)?.toLowerCase(),
    from: normalizeOptionalAuditText(options.from),
    to: normalizeOptionalAuditText(options.to),
  };
}

function normalizeOptionalAuditText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function auditEntryMatches(entry: BuilderAuthAuditEntry, options: BuilderAuthAuditReportOptions): boolean {
  if (options.status && entry.status !== options.status) {
    return false;
  }
  if (options.method && entry.method.toUpperCase() !== options.method.toUpperCase()) {
    return false;
  }
  if (options.route && !entry.route.toLowerCase().includes(options.route.toLowerCase())) {
    return false;
  }
  if (options.keyId && entry.keyId !== options.keyId) {
    return false;
  }
  if (options.actorId && entry.actorId !== options.actorId) {
    return false;
  }
  if (options.from && entry.at < options.from) {
    return false;
  }
  if (options.to && entry.at > options.to) {
    return false;
  }
  if (options.q) {
    const haystack = [
      entry.status,
      entry.method,
      entry.route,
      entry.keyId ?? "",
      entry.actorId ?? "",
      entry.source ?? "",
      entry.reason ?? "",
    ].join(" ").toLowerCase();
    if (!haystack.includes(options.q)) {
      return false;
    }
  }
  return true;
}

function buildAuditSummary(
  filteredEntries: BuilderAuthAuditEntry[],
  returnedEntries: BuilderAuthAuditEntry[],
): BuilderAuthAuditReport["summary"] {
  const statusCounts: Record<BuilderAuthAuditStatus, number> = {
    allowed: 0,
    missing: 0,
    rejected: 0,
  };
  const actorCounters = new Map<string, BuilderAuthAuditCounter>();
  const keyCounters = new Map<string, BuilderAuthAuditCounter>();
  const routeCounters = new Map<string, BuilderAuthAuditCounter>();
  let earliestAt: string | null = null;
  let latestAt: string | null = null;
  for (const entry of filteredEntries) {
    statusCounts[entry.status] += 1;
    if (earliestAt === null || entry.at < earliestAt) {
      earliestAt = entry.at;
    }
    if (latestAt === null || entry.at > latestAt) {
      latestAt = entry.at;
    }
    incrementAuditCounter(actorCounters, entry.actorId ?? "sem ator", entry.status);
    incrementAuditCounter(keyCounters, entry.keyId ?? "sem chave", entry.status);
    incrementAuditCounter(routeCounters, `${entry.method} ${entry.route}`, entry.status);
  }
  return {
    returnedCount: returnedEntries.length,
    statusCounts,
    uniqueActorCount: Array.from(actorCounters.keys()).filter((id) => id !== "sem ator").length,
    uniqueKeyCount: Array.from(keyCounters.keys()).filter((id) => id !== "sem chave").length,
    topActors: topAuditCounters(actorCounters),
    topKeys: topAuditCounters(keyCounters),
    topRoutes: topAuditCounters(routeCounters),
    earliestAt,
    latestAt,
  };
}

function incrementAuditCounter(
  counters: Map<string, BuilderAuthAuditCounter>,
  id: string,
  status: BuilderAuthAuditStatus,
): void {
  const current = counters.get(id) ?? { id, count: 0, allowed: 0, missing: 0, rejected: 0 };
  current.count += 1;
  current[status] += 1;
  counters.set(id, current);
}

function topAuditCounters(counters: Map<string, BuilderAuthAuditCounter>): BuilderAuthAuditCounter[] {
  return Array.from(counters.values())
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
    .slice(0, 5);
}

export async function builderAuthStatus(env: NodeJS.ProcessEnv = process.env): Promise<BuilderAuthStatus> {
  const config = await loadBuilderAuthConfig(env);
  const keys = config.keys.map(toInventoryKey);
  const fileConfigured = Boolean(env.AGENT_FLOW_BUILDER_API_KEYS_PATH?.trim());
  const sessionPathConfigured = Boolean(builderAuthSessionPersistencePath(env));
  const sessionService = builderAuthSessionServiceConfig(env);
  const sessionIntrospection = builderAuthSessionIntrospectionConfig(env);
  const auditPathConfigured = Boolean(env.AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH?.trim());
  const auditSink = builderAuthAuditSinkConfig(env);
  const externalGroupDirectory = builderAuthExternalGroupDirectoryConfig(env);
  const groupPolicyPathConfigured = Boolean(env.AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES_PATH?.trim());
  const groupDirectoryPathConfigured = Boolean(env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_PATH?.trim());
  const directoryGroups = builderAuthGroupDirectoryGroups(config.groupDirectory);
  return {
    enabled: config.required || keys.length > 0 || config.jwt.configured,
    required: config.required,
    keyCount: keys.length,
    activeKeyCount: keys.filter((key) => !key.disabled && !key.expired).length,
    keys,
    jwt: {
      configured: config.jwt.configured,
      algorithms: config.jwt.algorithms,
      issuerConfigured: config.jwt.issuer.length > 0,
      audienceConfigured: config.jwt.audience.length > 0,
      jwks: {
        configured: config.jwt.jwksPathConfigured || config.jwt.jwksUrlConfigured || config.jwt.oidcDiscoveredJwks,
        pathConfigured: config.jwt.jwksPathConfigured,
        urlConfigured: config.jwt.jwksUrlConfigured,
        keyCount: config.jwt.jwksKeys.length,
        cacheSeconds: config.jwt.jwksCacheSeconds,
        storesPublicKeysOnly: true,
      },
      oidc: {
        configured: config.jwt.oidcConfigured,
        issuerConfigured: config.jwt.oidcIssuerUrlConfigured,
        discoveryUrlConfigured: config.jwt.oidcDiscoveryUrlConfigured,
        discoveredJwks: config.jwt.oidcDiscoveredJwks,
        loginConfigured: config.jwt.oidcLogin.configured,
        logoutConfigured: config.jwt.oidcLogin.logoutConfigured,
        authorizationEndpointConfigured: Boolean(config.jwt.oidcLogin.authorizationEndpoint),
        tokenEndpointConfigured: Boolean(config.jwt.oidcLogin.tokenEndpoint),
        endSessionEndpointConfigured: Boolean(config.jwt.oidcLogin.endSessionEndpoint),
        redirectUriConfigured: Boolean(config.jwt.oidcLogin.redirectUri),
        postLogoutRedirectUriConfigured: Boolean(config.jwt.oidcLogin.postLogoutRedirectUri),
        logoutCallbackSupported: true,
        sessionIdTokenHintSupported: config.jwt.oidcLogin.configured && config.jwt.oidcLogin.logoutConfigured,
        sessionRefreshSupported: config.jwt.oidcLogin.configured && Boolean(config.jwt.oidcLogin.tokenEndpoint),
        usesDiscoveryCache: true,
      },
      actorClaim: config.jwt.actorClaims.join(","),
      roleClaim: config.jwt.roleClaims.join(","),
      groupsClaim: config.jwt.groupsClaims.join(","),
      areasClaim: config.jwt.areasClaims.join(","),
      scopesClaim: config.jwt.scopesClaims.join(","),
      acceptsBearer: true,
      storesJwtSecrets: false,
    },
    rotation: {
      fileConfigured,
      canWriteFile: fileConfigured,
      storesKeyHashes: true,
      returnsRawKeyOnce: true,
    },
    sessions: {
      ttlSeconds: builderAuthSessionTtlSeconds(env),
      persistent: sessionPathConfigured,
      pathConfigured: sessionPathConfigured,
      centralLocalStore: sessionPathConfigured,
      externalServiceConfigured: sessionService.configured,
      externalServiceUrlConfigured: sessionService.urlConfigured,
      externalServiceTokenConfigured: sessionService.tokenConfigured,
      externalServiceTimeoutMs: sessionService.timeoutMs,
      externalServiceInvalidReason: sessionService.invalidReason,
      centralIntrospectionConfigured: sessionIntrospection.configured,
      centralIntrospectionRequired: sessionIntrospection.required,
      centralIntrospectionUrlConfigured: sessionIntrospection.urlConfigured,
      centralIntrospectionTokenConfigured: sessionIntrospection.tokenConfigured,
      centralIntrospectionTimeoutMs: sessionIntrospection.timeoutMs,
      centralIntrospectionInvalidReason: sessionIntrospection.invalidReason,
      storesTokenHashes: true,
      storesRawTokens: false,
      storesProviderTokens: false,
      externalServiceSendsTokenHashes: true,
      externalServiceSendsRawTokens: false,
      externalServiceNonBlocking: true,
      centralIntrospectionSendsTokenHashes: true,
      centralIntrospectionSendsRawTokens: false,
      centralIntrospectionEnforcesCentralDecision: sessionIntrospection.configured,
      centralIntrospectionFailClosed: sessionIntrospection.configured && sessionIntrospection.required,
    },
    audit: {
      persistent: auditPathConfigured,
      pathConfigured: auditPathConfigured,
      externalSinkConfigured: auditSink.configured,
      externalSinkUrlConfigured: auditSink.urlConfigured,
      externalSinkTokenConfigured: auditSink.tokenConfigured,
      externalSinkTimeoutMs: auditSink.timeoutMs,
      externalSinkInvalidReason: auditSink.invalidReason,
      sendsRawKeyValues: false,
      sendsHeaders: false,
      nonBlocking: true,
    },
    groupPolicies: {
      configured: config.groupPolicies.length > 0,
      pathConfigured: groupPolicyPathConfigured,
      policyCount: config.groupPolicies.length,
      groups: Array.from(new Set(config.groupPolicies.map((policy) => policy.group))).sort(),
      governance: {
        excludesRawTokens: true,
        excludesSecretValues: true,
        localOnly: true,
      },
    },
    groupDirectory: {
      configured: config.groupDirectory.actors.length > 0 || config.groupDirectory.groups.length > 0,
      pathConfigured: groupDirectoryPathConfigured,
      externalConfigured: externalGroupDirectory.configured,
      externalUrlConfigured: externalGroupDirectory.urlConfigured,
      externalTokenConfigured: externalGroupDirectory.tokenConfigured,
      externalTimeoutMs: externalGroupDirectory.timeoutMs,
      externalInvalidReason: externalGroupDirectory.invalidReason,
      actorCount: config.groupDirectory.actors.length,
      groupCount: directoryGroups.length,
      groups: directoryGroups,
      governance: {
        excludesRawTokens: true,
        excludesSecretValues: true,
        enrichesIdentityGroups: true,
        externalSendsActorSecrets: false,
        localOnly: !externalGroupDirectory.configured,
      },
    },
    governance: {
      excludesRawKeyValues: true,
      excludesJwtSecrets: true,
      localOnly: true,
    },
  };
}

type BuilderAuthProbeHttpConfig =
  | BuilderAuthSessionServiceConfig
  | BuilderAuthSessionIntrospectionConfig
  | BuilderAuthAuditSinkConfig
  | BuilderAuthExternalGroupDirectoryConfig;

export async function probeBuilderAuthExternalIntegrations(
  env: NodeJS.ProcessEnv = process.env,
): Promise<BuilderAuthExternalProbeResult> {
  const components = await Promise.all([
    probeBuilderAuthSideEffectFreeEndpoint(
      "session_service",
      "Serviço corporativo de sessão",
      builderAuthSessionServiceConfig(env),
    ),
    probeBuilderAuthSideEffectFreeEndpoint(
      "session_introspection",
      "Decisão central de sessão",
      builderAuthSessionIntrospectionConfig(env),
    ),
    probeBuilderAuthSideEffectFreeEndpoint(
      "audit_sink",
      "Sink central de auditoria",
      builderAuthAuditSinkConfig(env),
    ),
    probeBuilderAuthGroupDirectoryEndpoint(builderAuthExternalGroupDirectoryConfig(env)),
  ]);
  return {
    format: "agent-flow-builder.builder-auth-external-probe.v1",
    generatedAt: new Date().toISOString(),
    configuredCount: components.filter((component) => component.urlConfigured).length,
    checkedCount: components.filter((component) => component.configured).length,
    okCount: components.filter((component) => component.status === "ok").length,
    warningCount: components.filter((component) => component.status === "warning").length,
    errorCount: components.filter((component) => component.status === "error" || component.status === "invalid_config").length,
    components,
    governance: {
      excludesUrls: true,
      excludesSecretValues: true,
      excludesRawKeyValues: true,
      excludesHeaders: true,
      excludesSessionTokens: true,
      excludesProviderTokens: true,
      authTokensInHeaderOnly: true,
      authTokensInBody: false,
      usesSideEffectFreeProbe: true,
    },
  };
}

export async function homologateBuilderAuthCorporateIntegrations(input: {
  workspaceRoot?: string;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<BuilderAuthCorporateHomologationResult> {
  const env = input.env ?? process.env;
  const [status, probe] = await Promise.all([
    builderAuthStatus(env),
    probeBuilderAuthExternalIntegrations(env),
  ]);
  const missingEvidence = builderAuthCorporateHomologationMissingEvidence(status, probe);
  const hasBlockingProbeFailure = probe.components.some((component) => (
    component.status === "error" || component.status === "invalid_config"
  ));
  const homologationStatus: BuilderAuthCorporateHomologationStatus = missingEvidence.length === 0
    ? "homologated"
    : hasBlockingProbeFailure || probe.checkedCount === 0
      ? "blocked"
      : "verified";
  const artifactRelativePath = ".agent-flow/builder-auth/corporate-homologation.afbuilderauthhomologation.json";
  const result: BuilderAuthCorporateHomologationResult = {
    format: "agent-flow-builder.builder-auth-corporate-homologation.v1",
    generatedAt: new Date().toISOString(),
    status: homologationStatus,
    homologationLevel: homologationStatus === "homologated"
      ? "full_external_probe"
      : homologationStatus === "verified"
        ? "partial_external_probe"
        : "none",
    requiredComponentCount: 4,
    configuredCount: probe.configuredCount,
    checkedCount: probe.checkedCount,
    okCount: probe.okCount,
    warningCount: probe.warningCount,
    errorCount: probe.errorCount,
    missingEvidence,
    artifact: {
      saved: false,
      relativePath: input.workspaceRoot ? artifactRelativePath : null,
    },
    statusSnapshot: {
      authRequired: status.required,
      activeKeyCount: status.activeKeyCount,
      jwtConfigured: status.jwt.configured,
      oidcConfigured: status.jwt.oidc.configured,
      centralLocalSessionStore: status.sessions.centralLocalStore,
      sessionServiceConfigured: status.sessions.externalServiceConfigured,
      centralIntrospectionConfigured: status.sessions.centralIntrospectionConfigured,
      centralIntrospectionRequired: status.sessions.centralIntrospectionRequired,
      auditSinkConfigured: status.audit.externalSinkConfigured,
      groupDirectoryExternalConfigured: status.groupDirectory.externalConfigured,
      groupPoliciesConfigured: status.groupPolicies.configured,
    },
    components: probe.components,
    governance: {
      excludesUrls: true,
      excludesSecretValues: true,
      excludesRawKeyValues: true,
      excludesHeaders: true,
      excludesSessionTokens: true,
      excludesProviderTokens: true,
      excludesResolvedLocalPaths: true,
      storesHomologationArtifactLocally: Boolean(input.workspaceRoot),
      authTokensInHeaderOnly: true,
      authTokensInBody: false,
      usesSideEffectFreeProbe: true,
    },
  };
  if (!input.workspaceRoot) {
    return result;
  }
  const outPath = path.join(input.workspaceRoot, artifactRelativePath);
  await mkdir(path.dirname(outPath), { recursive: true });
  const savedResult: BuilderAuthCorporateHomologationResult = {
    ...result,
    artifact: {
      saved: true,
      relativePath: artifactRelativePath,
    },
    governance: {
      ...result.governance,
      storesHomologationArtifactLocally: true,
    },
  };
  await writeFile(outPath, `${JSON.stringify(savedResult, null, 2)}\n`, "utf-8");
  return savedResult;
}

function builderAuthCorporateHomologationMissingEvidence(
  status: BuilderAuthStatus,
  probe: BuilderAuthExternalProbeResult,
): string[] {
  const missing: string[] = [];
  if (!status.required) {
    missing.push("builder_auth_not_required");
  }
  if (!status.activeKeyCount && !status.jwt.configured) {
    missing.push("no_active_builder_auth_source");
  }
  if (!status.sessions.externalServiceConfigured) {
    missing.push("session_service_not_configured");
  }
  if (!status.sessions.centralIntrospectionConfigured) {
    missing.push("central_introspection_not_configured");
  }
  if (status.sessions.centralIntrospectionConfigured && !status.sessions.centralIntrospectionRequired) {
    missing.push("central_introspection_not_fail_closed");
  }
  if (!status.audit.externalSinkConfigured) {
    missing.push("audit_sink_not_configured");
  }
  if (!status.groupDirectory.externalConfigured) {
    missing.push("group_directory_external_not_configured");
  }
  if (!status.groupPolicies.configured) {
    missing.push("group_policies_not_configured");
  }
  for (const componentId of ["session_service", "session_introspection", "audit_sink", "group_directory"] as const) {
    const component = probe.components.find((item) => item.id === componentId);
    if (!component) {
      missing.push(`${componentId}_probe_missing`);
    } else if (component.status !== "ok") {
      missing.push(`${componentId}_probe_${component.status}`);
    }
  }
  return missing;
}

export async function rotateBuilderAuthKey(
  payload: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BuilderAuthKeyRotationResult> {
  const filePath = requiredKeyFilePath(env);
  const existing = await readBuilderAuthFileKeys(filePath);
  const keyValue = `afbk_${randomBytes(24).toString("base64url")}`;
  const key = normalizeKeyEntry({
    keyHash: hashKey(keyValue),
    keyId: isRecord(payload) && typeof payload.keyId === "string" ? payload.keyId : `builder-${Date.now().toString(36)}`,
    actorId: isRecord(payload) && typeof payload.actorId === "string" ? payload.actorId : "local-studio",
    name: isRecord(payload) && typeof payload.name === "string" ? payload.name : undefined,
    role: isRecord(payload) && typeof payload.role === "string" ? payload.role : "reviewer",
    groups: isRecord(payload) ? payload.groups : undefined,
    areas: isRecord(payload) ? payload.areas : undefined,
    scopes: isRecord(payload) ? payload.scopes : undefined,
    expiresAt: isRecord(payload) && typeof payload.expiresAt === "string" ? payload.expiresAt : undefined,
    source: "file",
  });
  const nextKeys = [...existing.filter((item) => item.keyId !== key.keyId), key];
  await writeBuilderAuthFileKeys(filePath, nextKeys);
  const status = await builderAuthStatus(env);
  return {
    format: "agent-flow-builder.builder-auth-key-rotation.v1",
    generatedAt: new Date().toISOString(),
    keyValue,
    key: toInventoryKey(key),
    status,
    governance: {
      storesRawKeyValue: false,
      storesKeyHash: true,
      returnsRawKeyValueOnce: true,
      excludesExistingRawKeyValues: true,
      localOnly: true,
    },
  };
}

export async function disableBuilderAuthKey(
  keyId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BuilderAuthStatus> {
  const filePath = requiredKeyFilePath(env);
  const normalizedKeyId = normalizeId(keyId);
  const existing = await readBuilderAuthFileKeys(filePath);
  let found = false;
  const nextKeys = existing.map((key) => {
    if (key.keyId !== normalizedKeyId) {
      return key;
    }
    found = true;
    return { ...key, disabled: true };
  });
  if (!found) {
    throw new WorkspaceError("Chave local do Builder não encontrada no arquivo rotacionável.", 404);
  }
  await writeBuilderAuthFileKeys(filePath, nextKeys);
  return builderAuthStatus(env);
}

function toAuditEntry(
  seq: number,
  input: {
    result: Exclude<BuilderAuthResult, { status: "disabled" }>;
    method: string;
    route: string;
  },
): BuilderAuthAuditEntry {
  const identity = input.result.status === "authenticated" ? input.result.identity : null;
  return {
    seq,
    at: new Date().toISOString(),
    status: input.result.status === "authenticated" ? "allowed" : input.result.status,
    method: input.method.toUpperCase(),
    route: input.route,
    keyId: identity?.keyId ?? null,
    actorId: identity?.actorId ?? null,
    source: identity?.source ?? null,
    reason: input.result.reason,
  };
}

function builderAuthAuditSinkConfig(env: NodeJS.ProcessEnv): BuilderAuthAuditSinkConfig {
  const rawUrl = env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL?.trim() || "";
  const timeoutMs = normalizeBuilderAuthAuditSinkTimeoutMs(env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TIMEOUT_MS);
  const token = env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN?.trim() || "";
  if (!rawUrl) {
    return {
      configured: false,
      urlConfigured: false,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: null,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: "URL inválida.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: "Use http ou https.",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: "URL não deve conter usuário ou senha.",
    };
  }
  parsed.hash = "";
  return {
    configured: true,
    urlConfigured: true,
    url: parsed.toString(),
    token,
    tokenConfigured: Boolean(token),
    timeoutMs,
    invalidReason: null,
  };
}

function normalizeBuilderAuthAuditSinkTimeoutMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 2000;
  }
  return Math.max(250, Math.min(10000, Math.floor(parsed)));
}

function builderAuthExternalProbeBase(
  id: BuilderAuthExternalProbeComponentId,
  label: string,
  config: BuilderAuthProbeHttpConfig,
  status: BuilderAuthExternalProbeStatus,
  statusCode: number | null,
  reason: string,
  usesSideEffectFreeProbe: boolean,
): BuilderAuthExternalProbeComponent {
  return {
    id,
    label,
    configured: config.configured,
    urlConfigured: config.urlConfigured,
    tokenConfigured: config.tokenConfigured,
    timeoutMs: config.timeoutMs,
    status,
    statusCode,
    reason,
    governance: {
      excludesUrls: true,
      excludesSecretValues: true,
      sendsAuthTokenInHeaderOnly: true,
      sendsAuthTokenInBody: false,
      sendsRawKeyValues: false,
      sendsSessionTokens: false,
      sendsProviderTokens: false,
      usesSideEffectFreeProbe,
    },
  };
}

async function probeBuilderAuthSideEffectFreeEndpoint(
  id: Exclude<BuilderAuthExternalProbeComponentId, "group_directory">,
  label: string,
  config: BuilderAuthProbeHttpConfig,
): Promise<BuilderAuthExternalProbeComponent> {
  if (!config.urlConfigured) {
    return builderAuthExternalProbeBase(id, label, config, "not_configured", null, "URL não configurada.", true);
  }
  if (!config.configured) {
    return builderAuthExternalProbeBase(
      id,
      label,
      config,
      "invalid_config",
      null,
      config.invalidReason ?? "Configuração inválida.",
      true,
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (config.token) {
      headers.authorization = `Bearer ${config.token}`;
    }
    const response = await fetch(config.url, {
      method: "HEAD",
      headers,
      signal: controller.signal,
    });
    if (response.status === 405) {
      return builderAuthExternalProbeBase(
        id,
        label,
        config,
        "warning",
        response.status,
        "Endpoint respondeu, mas não aceita HEAD; valide o contrato principal no serviço corporativo.",
        true,
      );
    }
    if (response.ok) {
      return builderAuthExternalProbeBase(id, label, config, "ok", response.status, "Endpoint respondeu sem corpo.", true);
    }
    return builderAuthExternalProbeBase(id, label, config, "error", response.status, `Endpoint respondeu HTTP ${response.status}.`, true);
  } catch {
    return builderAuthExternalProbeBase(id, label, config, "error", null, "Endpoint indisponível ou timeout.", true);
  } finally {
    clearTimeout(timeout);
  }
}

async function probeBuilderAuthGroupDirectoryEndpoint(
  config: BuilderAuthExternalGroupDirectoryConfig,
): Promise<BuilderAuthExternalProbeComponent> {
  const label = "Diretório corporativo de grupos";
  if (!config.urlConfigured) {
    return builderAuthExternalProbeBase("group_directory", label, config, "not_configured", null, "URL não configurada.", true);
  }
  if (!config.configured) {
    return builderAuthExternalProbeBase(
      "group_directory",
      label,
      config,
      "invalid_config",
      null,
      config.invalidReason ?? "Configuração inválida.",
      true,
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {};
    if (config.token) {
      headers.authorization = `Bearer ${config.token}`;
    }
    const response = await fetch(config.url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return builderAuthExternalProbeBase(
        "group_directory",
        label,
        config,
        "error",
        response.status,
        `Diretório respondeu HTTP ${response.status}.`,
        true,
      );
    }
    const raw = await response.text();
    const directory = normalizeBuilderAuthGroupDirectoryPackage(raw, "external-probe");
    return {
      ...builderAuthExternalProbeBase(
        "group_directory",
        label,
        config,
        "ok",
        response.status,
        `${directory.actors.length} ator(es), ${directory.groups.length} grupo(s) retornado(s).`,
        true,
      ),
      actorCount: directory.actors.length,
      groupCount: directory.groups.length,
    };
  } catch {
    return builderAuthExternalProbeBase("group_directory", label, config, "error", null, "Diretório indisponível ou timeout.", true);
  } finally {
    clearTimeout(timeout);
  }
}

async function sendBuilderAuthAuditSinkEvent(entry: BuilderAuthAuditEntry, config: BuilderAuthAuditSinkConfig): Promise<void> {
  if (!config.configured) {
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (config.token) {
      headers.authorization = `Bearer ${config.token}`;
    }
    const event: BuilderAuthAuditSinkEvent = {
      format: "agent-flow-builder.builder-auth-audit-sink-event.v1",
      generatedAt: new Date().toISOString(),
      entry,
      governance: {
        excludesRawKeyValues: true,
        excludesHeaders: true,
        excludesSessionTokens: true,
        sinkAuthTokenInBody: false,
      },
    };
    await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch {
    // Auth must not fail just because the optional central audit sink is unavailable.
  } finally {
    clearTimeout(timeout);
  }
}

export async function authenticateBuilderRequest(
  headers: HeaderBag,
  env: NodeJS.ProcessEnv = process.env,
  options: { sessionStore?: BuilderAuthSessionStore } = {},
): Promise<BuilderAuthResult> {
  const config = await loadBuilderAuthConfig(env);
  if (!config.required) {
    return { status: "disabled", identity: null, reason: null };
  }
  if (!config.keys.length && !config.jwt.configured) {
    return {
      status: "rejected",
      identity: null,
      reason: "Builder auth obrigatório, mas nenhuma chave local ou JWT local foi configurado.",
    };
  }
  const directKey = readDirectProvidedKey(headers);
  const bearerToken = readBearerToken(headers);
  if (!directKey && bearerToken.startsWith("afbs_") && options.sessionStore) {
    return await options.sessionStore.authenticate(bearerToken);
  }
  if (!directKey && bearerToken && config.jwt.configured && looksLikeJwt(bearerToken)) {
    return authenticateBuilderJwt(bearerToken, config.jwt, config.groupDirectory, config.groupPolicies);
  }
  const providedKey = directKey || bearerToken;
  if (!providedKey) {
    return { status: "missing", identity: null, reason: "Informe X-Agent-Flow-Builder-Key ou Authorization: Bearer." };
  }
  if (!config.keys.length) {
    return { status: "rejected", identity: null, reason: "Token Bearer não é uma chave local nem um JWT válido do Builder." };
  }
  const providedHash = hashKey(providedKey);
  const matched = config.keys.find((key) => safeEqualHex(key.keyHash, providedHash));
  if (!matched) {
    return { status: "rejected", identity: null, reason: "Chave local do Builder inválida." };
  }
  if (matched.disabled) {
    return { status: "rejected", identity: null, reason: "Chave local do Builder desabilitada." };
  }
  if (isExpired(matched.expiresAt)) {
    return { status: "rejected", identity: null, reason: "Chave local do Builder expirada." };
  }
  return withBuilderAuthGroupDirectoryAndPolicies({
    status: "authenticated",
    identity: {
      keyId: matched.keyId,
      actorId: matched.actorId,
      name: matched.name,
      role: matched.role,
      groups: matched.groups,
      areas: matched.areas,
      scopes: matched.scopes,
      source: matched.source,
      expiresAt: matched.expiresAt,
    },
    reason: null,
  }, config.groupDirectory, config.groupPolicies);
}

async function loadBuilderAuthConfig(env: NodeJS.ProcessEnv): Promise<BuilderAuthConfig> {
  const required = env.AGENT_FLOW_BUILDER_AUTH_REQUIRED === "true";
  const keys: BuilderAuthKey[] = [];
  const jwt = await loadBuilderAuthJwtConfig(env);
  const groupDirectory = await loadBuilderAuthGroupDirectory(env);
  const groupPolicies = await loadBuilderAuthGroupPolicies(env);
  if (env.AGENT_FLOW_BUILDER_API_KEY) {
    keys.push(normalizeKeyEntry({
      key: env.AGENT_FLOW_BUILDER_API_KEY,
      keyId: env.AGENT_FLOW_BUILDER_API_KEY_ID || "builder-local",
      actorId: env.AGENT_FLOW_BUILDER_ACTOR_ID || "local-studio",
      name: env.AGENT_FLOW_BUILDER_ACTOR_NAME || env.AGENT_FLOW_BUILDER_ACTOR_ID || "local-studio",
      role: env.AGENT_FLOW_BUILDER_ACTOR_ROLE || "owner",
      groups: env.AGENT_FLOW_BUILDER_ACTOR_GROUPS,
      areas: env.AGENT_FLOW_BUILDER_ACTOR_AREAS,
      scopes: env.AGENT_FLOW_BUILDER_SCOPES,
      source: "env",
    }));
  }
  if (env.AGENT_FLOW_BUILDER_API_KEYS) {
    keys.push(...normalizeKeyPackage(env.AGENT_FLOW_BUILDER_API_KEYS, "env-json"));
  }
  if (env.AGENT_FLOW_BUILDER_API_KEYS_PATH) {
    try {
      const raw = await readFile(env.AGENT_FLOW_BUILDER_API_KEYS_PATH, "utf-8");
      keys.push(...normalizeKeyPackage(raw, "file"));
    } catch {
      // A missing rotation file is treated as an empty local key registry.
    }
  }
  return { required, keys: dedupeKeys(keys), jwt, groupDirectory, groupPolicies };
}

async function loadBuilderAuthGroupDirectory(env: NodeJS.ProcessEnv): Promise<BuilderAuthGroupDirectory> {
  const directories: BuilderAuthGroupDirectory[] = [];
  if (env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY) {
    directories.push(normalizeBuilderAuthGroupDirectoryPackage(env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY, "env-json"));
  }
  const directoryPath = env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_PATH?.trim() ?? "";
  if (directoryPath) {
    try {
      const raw = await readFile(directoryPath, "utf-8");
      directories.push(normalizeBuilderAuthGroupDirectoryPackage(raw, "file"));
    } catch {
      // Missing or unreadable optional group directory files must not break local auth.
    }
  }
  const externalDirectory = await loadBuilderAuthExternalGroupDirectory(env);
  if (externalDirectory.actors.length || externalDirectory.groups.length) {
    directories.push(externalDirectory);
  }
  return mergeBuilderAuthGroupDirectories(directories);
}

async function loadBuilderAuthGroupPolicies(env: NodeJS.ProcessEnv): Promise<BuilderAuthGroupPolicy[]> {
  const policies: BuilderAuthGroupPolicy[] = [];
  if (env.AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES) {
    policies.push(...normalizeBuilderAuthGroupPolicyPackage(env.AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES, "env-json"));
  }
  const policiesPath = env.AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES_PATH?.trim() ?? "";
  if (policiesPath) {
    try {
      const raw = await readFile(policiesPath, "utf-8");
      policies.push(...normalizeBuilderAuthGroupPolicyPackage(raw, "file"));
    } catch {
      // Missing or unreadable optional group policy files must not break local auth.
    }
  }
  return policies;
}

function withBuilderAuthGroupPolicies(
  result: BuilderAuthResult,
  policies: BuilderAuthGroupPolicy[],
): BuilderAuthResult {
  if (result.status !== "authenticated" || !policies.length || !result.identity.groups.length) {
    return result;
  }
  const identityGroups = new Set(result.identity.groups.map(normalizeGroupPolicyGroup).filter(Boolean));
  const matched = policies.filter((policy) => identityGroups.has(policy.group));
  if (!matched.length) {
    return result;
  }
  const role = maxBuilderAuthRole(
    normalizeBuilderAuthRole(result.identity.role),
    ...matched.map((policy) => policy.role).filter((role): role is BuilderAuthRole => role !== null),
  );
  return {
    ...result,
    identity: {
      ...result.identity,
      role,
      areas: mergeBuilderAuthStringSets(result.identity.areas, matched.flatMap((policy) => policy.areas), ["*"]),
      scopes: mergeBuilderAuthStringSets(result.identity.scopes, matched.flatMap((policy) => policy.scopes), []),
    },
  };
}

function withBuilderAuthGroupDirectoryAndPolicies(
  result: BuilderAuthResult,
  directory: BuilderAuthGroupDirectory,
  policies: BuilderAuthGroupPolicy[],
): BuilderAuthResult {
  return withBuilderAuthGroupPolicies(withBuilderAuthGroupDirectory(result, directory), policies);
}

function withBuilderAuthGroupDirectory(
  result: BuilderAuthResult,
  directory: BuilderAuthGroupDirectory,
): BuilderAuthResult {
  if (result.status !== "authenticated" || (!directory.actors.length && !directory.groups.length)) {
    return result;
  }
  const actorId = normalizeId(result.identity.actorId);
  const directGroups = directory.actors
    .filter((entry) => entry.actorId === actorId)
    .flatMap((entry) => entry.groups);
  const memberGroups = directory.groups
    .filter((entry) => entry.members.map(normalizeId).includes(actorId))
    .map((entry) => entry.group);
  const groups = mergeBuilderAuthStringSets(result.identity.groups, [...directGroups, ...memberGroups], []);
  if (groups.length === result.identity.groups.length && groups.every((group, index) => group === result.identity.groups[index])) {
    return result;
  }
  return {
    ...result,
    identity: {
      ...result.identity,
      groups,
    },
  };
}

async function loadBuilderAuthJwtConfig(env: NodeJS.ProcessEnv): Promise<BuilderAuthJwtConfig> {
  const secret = env.AGENT_FLOW_BUILDER_AUTH_JWT_SECRET?.trim() ?? "";
  const publicKey = normalizePemEnv(env.AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY ?? "");
  const jwksPath = env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH?.trim() ?? "";
  const jwksUrl = env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL?.trim() ?? "";
  const oidcIssuerUrl = env.AGENT_FLOW_BUILDER_AUTH_OIDC_ISSUER_URL?.trim() ?? "";
  const oidcDiscoveryUrl = env.AGENT_FLOW_BUILDER_AUTH_OIDC_DISCOVERY_URL?.trim() ?? "";
  const jwksCacheSeconds = normalizeJwksCacheSeconds(env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_CACHE_SECONDS);
  const oidcDiscovery = await discoverBuilderAuthOidc({
    issuerUrl: oidcIssuerUrl,
    discoveryUrl: oidcDiscoveryUrl,
    cacheSeconds: jwksCacheSeconds,
  });
  const effectiveJwksUrl = jwksUrl || oidcDiscovery.jwksUri;
  const jwksKeys = await loadBuilderAuthJwksKeys({ path: jwksPath, url: effectiveJwksUrl, cacheSeconds: jwksCacheSeconds });
  const configured = Boolean(secret || publicKey || jwksPath || jwksUrl || oidcIssuerUrl || oidcDiscoveryUrl);
  const explicitIssuers = normalizeStringList(env.AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER);
  const discoveredIssuers = [
    ...(oidcDiscovery.issuer ? [oidcDiscovery.issuer] : []),
    ...(oidcIssuerUrl ? [oidcIssuerUrl.replace(/\/$/, "")] : []),
  ];
  const oidcLogin = normalizeBuilderAuthOidcLoginConfig(env, oidcDiscovery, discoveredIssuers[0] ?? "");
  const explicitAudience = normalizeStringList(env.AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE);
  return {
    configured: configured || oidcLogin.configured,
    secret,
    publicKey,
    jwksKeys,
    jwksPathConfigured: Boolean(jwksPath),
    jwksUrlConfigured: Boolean(jwksUrl),
    oidcConfigured: Boolean(oidcIssuerUrl || oidcDiscoveryUrl),
    oidcIssuerUrlConfigured: Boolean(oidcIssuerUrl),
    oidcDiscoveryUrlConfigured: Boolean(oidcDiscoveryUrl),
    oidcDiscoveredJwks: Boolean(oidcDiscovery.jwksUri),
    oidcLogin,
    jwksCacheSeconds,
    algorithms: normalizeJwtAlgorithms(env.AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS, {
      secret,
      rsa: Boolean(publicKey || jwksPath || effectiveJwksUrl || jwksKeys.length),
    }),
    issuer: explicitIssuers.length ? explicitIssuers : Array.from(new Set(discoveredIssuers.filter(Boolean))),
    audience: explicitAudience.length ? explicitAudience : oidcLogin.clientId ? [oidcLogin.clientId] : [],
    actorClaims: normalizeClaimList(env.AGENT_FLOW_BUILDER_AUTH_JWT_ACTOR_CLAIM, ["sub"]),
    nameClaims: normalizeClaimList(env.AGENT_FLOW_BUILDER_AUTH_JWT_NAME_CLAIM, ["name", "email", "preferred_username", "sub"]),
    roleClaims: normalizeClaimList(env.AGENT_FLOW_BUILDER_AUTH_JWT_ROLE_CLAIM, ["role", "roles"]),
    groupsClaims: normalizeClaimList(env.AGENT_FLOW_BUILDER_AUTH_JWT_GROUPS_CLAIM, ["groups", "group", "member_of"]),
    areasClaims: normalizeClaimList(env.AGENT_FLOW_BUILDER_AUTH_JWT_AREAS_CLAIM, ["areas", "agent_flow_areas"]),
    scopesClaims: normalizeClaimList(env.AGENT_FLOW_BUILDER_AUTH_JWT_SCOPES_CLAIM, ["scope", "scp", "scopes"]),
    clockToleranceSeconds: normalizeClockTolerance(env.AGENT_FLOW_BUILDER_AUTH_JWT_CLOCK_TOLERANCE_SECONDS),
  };
}

function normalizeBuilderAuthOidcLoginConfig(
  env: NodeJS.ProcessEnv,
  discovery: BuilderAuthOidcDiscovery,
  issuer: string,
): BuilderAuthOidcLoginConfig {
  const authorizationEndpoint =
    env.AGENT_FLOW_BUILDER_AUTH_OIDC_AUTHORIZATION_ENDPOINT?.trim() ||
    discovery.authorizationEndpoint;
  const tokenEndpoint =
    env.AGENT_FLOW_BUILDER_AUTH_OIDC_TOKEN_ENDPOINT?.trim() ||
    discovery.tokenEndpoint;
  const endSessionEndpoint =
    env.AGENT_FLOW_BUILDER_AUTH_OIDC_END_SESSION_ENDPOINT?.trim() ||
    discovery.endSessionEndpoint;
  const clientId = env.AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_ID?.trim() ?? "";
  const redirectUri = env.AGENT_FLOW_BUILDER_AUTH_OIDC_REDIRECT_URI?.trim() ?? "";
  const postLogoutRedirectUri = env.AGENT_FLOW_BUILDER_AUTH_OIDC_POST_LOGOUT_REDIRECT_URI?.trim() ?? "";
  return {
    configured: Boolean(clientId && redirectUri && authorizationEndpoint && tokenEndpoint),
    logoutConfigured: Boolean(clientId && endSessionEndpoint),
    issuer: (discovery.issuer || issuer || "").replace(/\/$/, ""),
    authorizationEndpoint,
    tokenEndpoint,
    endSessionEndpoint,
    clientId,
    clientSecret: env.AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_SECRET?.trim() ?? "",
    redirectUri,
    postLogoutRedirectUri,
    scopes: normalizeOidcScopes(env.AGENT_FLOW_BUILDER_AUTH_OIDC_SCOPES),
    flowTtlSeconds: builderAuthOidcFlowTtlSeconds(env),
  };
}

async function exchangeBuilderAuthOidcCode(
  code: string,
  pending: BuilderAuthOidcPendingFlow,
  config: BuilderAuthOidcLoginConfig,
): Promise<BuilderAuthOidcTokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", pending.redirectUri);
  body.set("client_id", pending.clientId);
  body.set("code_verifier", pending.codeVerifier);
  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new WorkspaceError(`Token endpoint OIDC rejeitou o code com HTTP ${response.status}.`, 403);
    }
    return normalizeBuilderAuthOidcTokenResponse(raw);
  } finally {
    clearTimeout(timeout);
  }
}

async function exchangeBuilderAuthOidcRefreshToken(
  refreshToken: string,
  config: BuilderAuthOidcLoginConfig,
): Promise<BuilderAuthOidcTokenResponse> {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", config.clientId);
  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new WorkspaceError(`Token endpoint OIDC rejeitou refresh_token com HTTP ${response.status}.`, 403);
    }
    return normalizeBuilderAuthOidcTokenResponse(raw);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBuilderAuthOidcTokenResponse(raw: string): BuilderAuthOidcTokenResponse {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return { idToken: "", refreshToken: null, expiresIn: null };
    }
    const expiresIn = typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
      ? Math.max(0, Math.floor(parsed.expires_in))
      : null;
    return {
      idToken: typeof parsed.id_token === "string" ? parsed.id_token.trim() : "",
      refreshToken: typeof parsed.refresh_token === "string" && parsed.refresh_token.trim() ? parsed.refresh_token.trim() : null,
      expiresIn,
    };
  } catch {
    return { idToken: "", refreshToken: null, expiresIn: null };
  }
}

function validateOidcNonce(payload: Record<string, unknown>, pending: BuilderAuthOidcPendingFlow): void {
  const nonce = typeof payload.nonce === "string" ? payload.nonce.trim() : "";
  if (!nonce || !safeEqualHex(hashKey(nonce), pending.nonceHash)) {
    throw new WorkspaceError("Nonce OIDC do Builder inválido.", 403);
  }
}

function authenticateBuilderJwt(
  token: string,
  config: BuilderAuthJwtConfig,
  groupDirectory: BuilderAuthGroupDirectory = emptyBuilderAuthGroupDirectory(),
  groupPolicies: BuilderAuthGroupPolicy[] = [],
): BuilderAuthResult {
  const parts = parseJwtToken(token);
  if (!parts) {
    return { status: "rejected", identity: null, reason: "JWT local do Builder malformado." };
  }
  const algorithm = typeof parts.header.alg === "string" ? parts.header.alg : "";
  if (!config.algorithms.includes(algorithm)) {
    return { status: "rejected", identity: null, reason: `Algoritmo JWT ${algorithm || "ausente"} não permitido.` };
  }
  if (!verifyJwtSignature(parts, algorithm, config)) {
    return { status: "rejected", identity: null, reason: "Assinatura JWT local do Builder inválida." };
  }
  const claimError = validateJwtClaims(parts.payload, config);
  if (claimError) {
    return { status: "rejected", identity: null, reason: claimError };
  }
  const actorValue = firstJwtClaim(parts.payload, config.actorClaims);
  if (actorValue === undefined || actorValue === null || String(actorValue).trim() === "") {
    return { status: "rejected", identity: null, reason: "JWT local do Builder sem claim de ator configurada." };
  }
  const actorId = normalizeId(String(actorValue));
  const nameValue = firstJwtClaim(parts.payload, config.nameClaims);
  const keyIdValue = typeof parts.header.kid === "string" && parts.header.kid.trim() ? parts.header.kid : actorId;
  const expiresAt = jwtNumericDate(firstJwtClaim(parts.payload, ["exp"]));
  const areas = normalizeJwtStringList(firstJwtClaim(parts.payload, config.areasClaims));
  const scopes = normalizeJwtStringList(firstJwtClaim(parts.payload, config.scopesClaims));
  const groups = normalizeJwtStringList(firstJwtClaim(parts.payload, config.groupsClaims));
  return withBuilderAuthGroupDirectoryAndPolicies({
    status: "authenticated",
    identity: {
      keyId: `jwt-${normalizeId(keyIdValue)}`,
      actorId,
      name: nameValue === undefined || nameValue === null || String(nameValue).trim() === "" ? actorId : String(nameValue),
      role: normalizeJwtRole(firstJwtClaim(parts.payload, config.roleClaims)),
      groups,
      areas: areas.length ? areas : ["*"],
      scopes: scopes.length ? scopes : ["workspace:read"],
      source: "jwt",
      expiresAt: expiresAt === null ? null : new Date(expiresAt * 1000).toISOString(),
    },
    reason: null,
  }, groupDirectory, groupPolicies);
}

function parseJwtToken(token: string): JwtTokenParts | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return null;
  }
  try {
    const header = JSON.parse(base64UrlDecode(parts[0]).toString("utf-8")) as unknown;
    const payload = JSON.parse(base64UrlDecode(parts[1]).toString("utf-8")) as unknown;
    if (!isRecord(header) || !isRecord(payload)) {
      return null;
    }
    return {
      header,
      payload,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: base64UrlDecode(parts[2]),
    };
  } catch {
    return null;
  }
}

function verifyJwtSignature(parts: JwtTokenParts, algorithm: string, config: BuilderAuthJwtConfig): boolean {
  if (algorithm === "HS256") {
    if (!config.secret) {
      return false;
    }
    const expected = createHmac("sha256", config.secret).update(parts.signingInput).digest();
    return expected.length === parts.signature.length && timingSafeEqual(expected, parts.signature);
  }
  if (algorithm === "RS256") {
    const candidateKeys = builderAuthJwtPublicKeyCandidates(parts, config);
    if (!candidateKeys.length) {
      return false;
    }
    for (const publicKey of candidateKeys) {
      try {
        const verifier = createVerify("RSA-SHA256");
        verifier.update(parts.signingInput);
        verifier.end();
        if (verifier.verify(publicKey, parts.signature)) {
          return true;
        }
      } catch {
        // Try the next configured public key/JWKS entry.
      }
    }
    return false;
  }
  return false;
}

function builderAuthJwtPublicKeyCandidates(parts: JwtTokenParts, config: BuilderAuthJwtConfig): string[] {
  const kid = typeof parts.header.kid === "string" && parts.header.kid.trim() ? parts.header.kid.trim() : "";
  const jwks = config.jwksKeys
    .filter((key) => !kid || key.kid === kid)
    .filter((key) => !key.alg || key.alg === "RS256")
    .map((key) => key.publicKey);
  return [
    ...(config.publicKey ? [config.publicKey] : []),
    ...jwks,
  ];
}

function validateJwtClaims(payload: Record<string, unknown>, config: BuilderAuthJwtConfig): string | null {
  const now = Math.floor(Date.now() / 1000);
  const tolerance = config.clockToleranceSeconds;
  const exp = jwtNumericDate(firstJwtClaim(payload, ["exp"]));
  if (exp === null) {
    return "JWT local do Builder sem expiração exp.";
  }
  if (exp + tolerance <= now) {
    return "JWT local do Builder expirado.";
  }
  const nbf = jwtNumericDate(firstJwtClaim(payload, ["nbf"]));
  if (nbf !== null && nbf > now + tolerance) {
    return "JWT local do Builder ainda não é válido.";
  }
  const iat = jwtNumericDate(firstJwtClaim(payload, ["iat"]));
  if (iat !== null && iat > now + tolerance) {
    return "JWT local do Builder emitido no futuro.";
  }
  if (config.issuer.length) {
    const issuer = firstJwtClaim(payload, ["iss"]);
    if (typeof issuer !== "string" || !config.issuer.includes(issuer)) {
      return "Issuer do JWT local do Builder não permitido.";
    }
  }
  if (config.audience.length) {
    const audience = normalizeJwtStringList(firstJwtClaim(payload, ["aud"]));
    if (!audience.some((item) => config.audience.includes(item))) {
      return "Audience do JWT local do Builder não permitido.";
    }
  }
  return null;
}

function normalizeJwtRole(value: unknown): string {
  const roles = normalizeJwtStringList(value);
  const rank: Record<string, number> = { viewer: 0, reviewer: 1, operator: 2, owner: 3 };
  const best = roles
    .map((role) => role.trim().toLowerCase())
    .filter((role) => role in rank)
    .sort((left, right) => rank[right] - rank[left])[0];
  return best ?? "viewer";
}

function firstJwtClaim(payload: Record<string, unknown>, claims: string[]): unknown {
  for (const claim of claims) {
    if (Object.prototype.hasOwnProperty.call(payload, claim)) {
      return payload[claim];
    }
    const nested = readJwtNestedClaim(payload, claim);
    if (nested.found) {
      return nested.value;
    }
  }
  return undefined;
}

function readJwtNestedClaim(payload: Record<string, unknown>, claim: string): { found: boolean; value: unknown } {
  if (!claim.includes(".")) {
    return { found: false, value: undefined };
  }
  let current: unknown = payload;
  for (const part of claim.split(".")) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
      return { found: false, value: undefined };
    }
    current = current[part];
  }
  return { found: true, value: current };
}

function jwtNumericDate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function normalizeJwtStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.flatMap((item) => normalizeJwtStringList(item)))).sort();
  }
  if (typeof value === "string") {
    return Array.from(new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))).sort();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  return [];
}

function normalizeClaimList(value: string | undefined, fallback: string[]): string[] {
  const claims = normalizeStringList(value);
  return claims.length ? claims : fallback;
}

const builderAuthJwksUrlCache = new Map<string, { expiresAt: number; raw: string }>();
const builderAuthOidcDiscoveryCache = new Map<string, { expiresAt: number; metadata: BuilderAuthOidcDiscovery }>();

interface BuilderAuthOidcDiscovery {
  issuer: string;
  jwksUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  endSessionEndpoint: string;
}

async function discoverBuilderAuthOidc(input: {
  issuerUrl: string;
  discoveryUrl: string;
  cacheSeconds: number;
}): Promise<BuilderAuthOidcDiscovery> {
  const discoveryUrl = normalizeOidcDiscoveryUrl(input);
  if (!discoveryUrl) {
    return emptyOidcDiscovery();
  }
  const cached = builderAuthOidcDiscoveryCache.get(discoveryUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.metadata;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(discoveryUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`OIDC discovery HTTP ${response.status}`);
      }
      const parsed = normalizeOidcDiscovery(await response.text());
      builderAuthOidcDiscoveryCache.set(discoveryUrl, {
        metadata: parsed,
        expiresAt: Date.now() + input.cacheSeconds * 1000,
      });
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return { ...emptyOidcDiscovery(), issuer: input.issuerUrl.replace(/\/$/, "") };
  }
}

function normalizeOidcDiscoveryUrl(input: {
  issuerUrl: string;
  discoveryUrl: string;
}): string {
  if (input.discoveryUrl) {
    return input.discoveryUrl;
  }
  if (!input.issuerUrl) {
    return "";
  }
  return `${input.issuerUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
}

function normalizeOidcDiscovery(raw: string): BuilderAuthOidcDiscovery {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return emptyOidcDiscovery();
    }
    return {
      issuer: typeof parsed.issuer === "string" && parsed.issuer.trim() ? parsed.issuer.trim().replace(/\/$/, "") : "",
      jwksUri: typeof parsed.jwks_uri === "string" && parsed.jwks_uri.trim() ? parsed.jwks_uri.trim() : "",
      authorizationEndpoint: typeof parsed.authorization_endpoint === "string" && parsed.authorization_endpoint.trim()
        ? parsed.authorization_endpoint.trim()
        : "",
      tokenEndpoint: typeof parsed.token_endpoint === "string" && parsed.token_endpoint.trim()
        ? parsed.token_endpoint.trim()
        : "",
      endSessionEndpoint: typeof parsed.end_session_endpoint === "string" && parsed.end_session_endpoint.trim()
        ? parsed.end_session_endpoint.trim()
        : "",
    };
  } catch {
    return emptyOidcDiscovery();
  }
}

function emptyOidcDiscovery(): BuilderAuthOidcDiscovery {
  return {
    issuer: "",
    jwksUri: "",
    authorizationEndpoint: "",
    tokenEndpoint: "",
    endSessionEndpoint: "",
  };
}

async function loadBuilderAuthJwksKeys(input: {
  path: string;
  url: string;
  cacheSeconds: number;
}): Promise<BuilderAuthJwksKey[]> {
  const keys: BuilderAuthJwksKey[] = [];
  if (input.path) {
    try {
      const raw = await readFile(input.path, "utf-8");
      keys.push(...normalizeJwksPackage(raw, "jwks-file"));
    } catch {
      // A missing or invalid optional JWKS file should fail authentication, not server startup.
    }
  }
  if (input.url) {
    try {
      const raw = await readCachedJwksUrl(input.url, input.cacheSeconds);
      keys.push(...normalizeJwksPackage(raw, "jwks-url"));
    } catch {
      // A transient JWKS URL failure should surface as rejected JWT authentication.
    }
  }
  return dedupeJwksKeys(keys);
}

async function readCachedJwksUrl(url: string, cacheSeconds: number): Promise<string> {
  const cached = builderAuthJwksUrlCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.raw;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`JWKS HTTP ${response.status}`);
    }
    const raw = await response.text();
    builderAuthJwksUrlCache.set(url, {
      raw,
      expiresAt: Date.now() + cacheSeconds * 1000,
    });
    return raw;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeJwksPackage(raw: string, source: string): BuilderAuthJwksKey[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = isRecord(parsed) && Array.isArray(parsed.keys)
      ? parsed.keys
      : Array.isArray(parsed)
        ? parsed
        : [];
    return entries.flatMap((entry) => {
      const normalized = normalizeJwksKey(entry, source);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

function normalizeJwksKey(value: unknown, source: string): BuilderAuthJwksKey | null {
  if (!isRecord(value) || value.kty !== "RSA") {
    return null;
  }
  const n = typeof value.n === "string" ? value.n.trim() : "";
  const e = typeof value.e === "string" ? value.e.trim() : "";
  if (!n || !e) {
    return null;
  }
  const use = typeof value.use === "string" ? value.use.trim() : "";
  if (use && use !== "sig") {
    return null;
  }
  const alg = typeof value.alg === "string" && value.alg.trim() ? value.alg.trim() : null;
  if (alg && alg !== "RS256") {
    return null;
  }
  try {
    const keyObject = createPublicKey({
      key: {
        kty: "RSA",
        n,
        e,
      } as JsonWebKey,
      format: "jwk",
    });
    return {
      kid: typeof value.kid === "string" && value.kid.trim() ? value.kid.trim() : null,
      alg,
      publicKey: String(keyObject.export({ type: "spki", format: "pem" })),
      source,
    };
  } catch {
    return null;
  }
}

function dedupeJwksKeys(keys: BuilderAuthJwksKey[]): BuilderAuthJwksKey[] {
  const byKey = new Map<string, BuilderAuthJwksKey>();
  for (const key of keys) {
    byKey.set(`${key.kid ?? "nokid"}:${hashKey(key.publicKey)}`, key);
  }
  return [...byKey.values()];
}

function normalizeJwtAlgorithms(value: string | undefined, material: { secret: string; rsa: boolean }): string[] {
  const requested = normalizeStringList(value);
  const defaults = [
    ...(material.secret ? ["HS256"] : []),
    ...(material.rsa ? ["RS256"] : []),
  ];
  const candidates = requested.length ? requested : defaults;
  return Array.from(new Set(candidates.filter((algorithm) => {
    if (algorithm === "HS256") {
      return Boolean(material.secret);
    }
    if (algorithm === "RS256") {
      return material.rsa;
    }
    return false;
  }))).sort();
}

function normalizeJwksCacheSeconds(value: string | undefined): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 300;
  }
  return Math.max(30, Math.min(Math.floor(parsed), 24 * 60 * 60));
}

function normalizeClockTolerance(value: string | undefined): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 30;
  }
  return Math.min(Math.floor(parsed), 300);
}

function normalizePemEnv(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed.replace(/\\n/g, "\n");
  if (normalized.includes("-----BEGIN")) {
    return normalized;
  }
  try {
    return Buffer.from(normalized, "base64").toString("utf-8").trim();
  } catch {
    return normalized;
  }
}

function requiredKeyFilePath(env: NodeJS.ProcessEnv): string {
  const filePath = env.AGENT_FLOW_BUILDER_API_KEYS_PATH?.trim();
  if (!filePath) {
    throw new WorkspaceError("AGENT_FLOW_BUILDER_API_KEYS_PATH é obrigatório para rotacionar chaves do Builder.", 400);
  }
  return filePath;
}

async function readBuilderAuthFileKeys(filePath: string): Promise<BuilderAuthKey[]> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return normalizeKeyPackage(raw, "file");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeBuilderAuthFileKeys(filePath: string, keys: BuilderAuthKey[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const packageValue = {
    format: "agent-flow-builder.builder-auth-keys.v1",
    updatedAt: new Date().toISOString(),
    keys: keys.map((key) => ({
      key_id: key.keyId,
      actor_id: key.actorId,
      name: key.name,
      role: key.role,
      groups: key.groups,
      areas: key.areas,
      scopes: key.scopes,
      disabled: key.disabled,
      expires_at: key.expiresAt,
      keyHash: key.keyHash,
    })),
    governance: {
      storesRawKeyValues: false,
      storesKeyHashes: true,
      localOnly: true,
    },
  };
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(packageValue, null, 2)}\n`, "utf-8");
  await rename(tempPath, filePath);
}

function normalizeKeyPackage(raw: string, source: string): BuilderAuthKey[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.keys)
        ? parsed.keys
        : [];
    return entries.map((entry) => normalizeKeyEntry({ ...(isRecord(entry) ? entry : {}), source }));
  } catch {
    return [];
  }
}

function normalizeKeyEntry(value: Record<string, unknown>): BuilderAuthKey {
  const rawKey = firstString(value, ["key", "apiKey", "api_key", "value"]);
  const keyHash = normalizeHash(firstString(value, ["keyHash", "key_hash", "sha256", "hash"])) || hashKey(rawKey || "");
  const actorId = normalizeId(firstString(value, ["actorId", "actor_id", "participantId", "participant_id"]) || "local-studio");
  const name = firstString(value, ["name", "actorName", "actor_name"]) || actorId;
  const source = firstString(value, ["source"]) || "local";
  return {
    keyId: normalizeId(firstString(value, ["keyId", "key_id", "id"]) || `${source}-${keyHash.slice(0, 8)}`),
    actorId,
    name,
    role: firstString(value, ["role"]) || "reviewer",
    groups: normalizeStringList(value.groups),
    areas: normalizeStringList(value.areas).length ? normalizeStringList(value.areas) : ["*"],
    scopes: normalizeStringList(value.scopes).length ? normalizeStringList(value.scopes) : ["*"],
    source,
    disabled: value.disabled === true,
    expiresAt: normalizeDate(firstString(value, ["expiresAt", "expires_at"])),
    keyHash,
  };
}

function normalizeBuilderAuthGroupPolicyPackage(raw: string, source: string): BuilderAuthGroupPolicy[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.policies)
        ? parsed.policies
        : isRecord(parsed) && Array.isArray(parsed.groups)
          ? parsed.groups
          : [];
    return entries
      .map((entry) => normalizeBuilderAuthGroupPolicyEntry(isRecord(entry) ? entry : {}, source))
      .filter((entry): entry is BuilderAuthGroupPolicy => entry !== null);
  } catch {
    return [];
  }
}

function normalizeBuilderAuthGroupPolicyEntry(
  value: Record<string, unknown>,
  source: string,
): BuilderAuthGroupPolicy | null {
  const group = normalizeGroupPolicyGroup(firstString(value, ["group", "groupId", "group_id", "id", "name"]));
  if (!group) {
    return null;
  }
  return {
    group,
    role: typeof value.role === "string" && value.role.trim() ? normalizeBuilderAuthRole(value.role) : null,
    areas: normalizeStringList(value.areas),
    scopes: normalizeStringList(value.scopes),
    source,
  };
}

function normalizeBuilderAuthGroupDirectoryPackage(raw: string, source: string): BuilderAuthGroupDirectory {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return emptyBuilderAuthGroupDirectory();
    }
    const actorEntries = [
      ...arrayValue(parsed.actors),
      ...arrayValue(parsed.users),
      ...arrayValue(parsed.memberships),
      ...arrayValue(parsed.principals),
    ];
    const actors = actorEntries
      .map((entry) => normalizeBuilderAuthGroupDirectoryActor(isRecord(entry) ? entry : {}, source))
      .filter((entry): entry is BuilderAuthGroupDirectoryActor => entry !== null);
    const groups = arrayValue(parsed.groups)
      .map((entry) => normalizeBuilderAuthGroupDirectoryGroup(isRecord(entry) ? entry : {}, source))
      .filter((entry): entry is BuilderAuthGroupDirectoryGroup => entry !== null);
    return mergeBuilderAuthGroupDirectories([{ actors, groups }]);
  } catch {
    return emptyBuilderAuthGroupDirectory();
  }
}

async function loadBuilderAuthExternalGroupDirectory(env: NodeJS.ProcessEnv): Promise<BuilderAuthGroupDirectory> {
  const config = builderAuthExternalGroupDirectoryConfig(env);
  if (!config.configured) {
    return emptyBuilderAuthGroupDirectory();
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
    };
    if (config.token) {
      headers.authorization = `Bearer ${config.token}`;
    }
    const response = await fetch(config.url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      return emptyBuilderAuthGroupDirectory();
    }
    const raw = await response.text();
    return normalizeBuilderAuthGroupDirectoryPackage(raw, "external-http");
  } catch {
    return emptyBuilderAuthGroupDirectory();
  } finally {
    clearTimeout(timeout);
  }
}

function builderAuthExternalGroupDirectoryConfig(env: NodeJS.ProcessEnv): BuilderAuthExternalGroupDirectoryConfig {
  const rawUrl = env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL?.trim() || "";
  const token = env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN?.trim() || "";
  const timeoutMs = normalizeBuilderAuthExternalGroupDirectoryTimeoutMs(env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TIMEOUT_MS);
  if (!rawUrl) {
    return {
      configured: false,
      urlConfigured: false,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: null,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: "URL inválida.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: "Use http ou https.",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: "URL não deve conter usuário ou senha.",
    };
  }
  parsed.hash = "";
  return {
    configured: true,
    urlConfigured: true,
    url: parsed.toString(),
    token,
    tokenConfigured: Boolean(token),
    timeoutMs,
    invalidReason: null,
  };
}

function normalizeBuilderAuthExternalGroupDirectoryTimeoutMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 2000;
  }
  return Math.max(250, Math.min(10000, Math.floor(parsed)));
}

function normalizeBuilderAuthGroupDirectoryActor(
  value: Record<string, unknown>,
  source: string,
): BuilderAuthGroupDirectoryActor | null {
  const actorId = normalizeId(firstString(value, ["actorId", "actor_id", "userId", "user_id", "principalId", "principal_id", "id", "sub"]));
  const groups = normalizeStringList(value.groups).map(normalizeGroupPolicyGroup).filter(Boolean);
  if (!actorId || !groups.length) {
    return null;
  }
  return {
    actorId,
    groups,
    source,
  };
}

function normalizeBuilderAuthGroupDirectoryGroup(
  value: Record<string, unknown>,
  source: string,
): BuilderAuthGroupDirectoryGroup | null {
  const group = normalizeGroupPolicyGroup(firstString(value, ["group", "groupId", "group_id", "id", "name"]));
  const members = [
    ...normalizeStringList(value.members),
    ...normalizeStringList(value.memberIds),
    ...normalizeStringList(value.member_ids),
    ...normalizeStringList(value.actors),
    ...normalizeStringList(value.actorIds),
    ...normalizeStringList(value.actor_ids),
    ...normalizeStringList(value.users),
    ...normalizeStringList(value.userIds),
    ...normalizeStringList(value.user_ids),
  ].map(normalizeId).filter(Boolean);
  if (!group || !members.length) {
    return null;
  }
  return {
    group,
    members,
    source,
  };
}

function mergeBuilderAuthGroupDirectories(directories: BuilderAuthGroupDirectory[]): BuilderAuthGroupDirectory {
  const actorGroups = new Map<string, Set<string>>();
  const groupMembers = new Map<string, Set<string>>();
  for (const directory of directories) {
    for (const actor of directory.actors) {
      const groups = actorGroups.get(actor.actorId) ?? new Set<string>();
      for (const group of actor.groups) {
        groups.add(normalizeGroupPolicyGroup(group));
      }
      actorGroups.set(actor.actorId, groups);
    }
    for (const group of directory.groups) {
      const members = groupMembers.get(group.group) ?? new Set<string>();
      for (const member of group.members) {
        members.add(normalizeId(member));
      }
      groupMembers.set(group.group, members);
    }
  }
  return {
    actors: Array.from(actorGroups.entries()).map(([actorId, groups]) => ({
      actorId,
      groups: Array.from(groups).filter(Boolean).sort(),
      source: "merged",
    })).filter((entry) => entry.groups.length > 0),
    groups: Array.from(groupMembers.entries()).map(([group, members]) => ({
      group,
      members: Array.from(members).filter(Boolean).sort(),
      source: "merged",
    })).filter((entry) => entry.members.length > 0),
  };
}

function builderAuthGroupDirectoryGroups(directory: BuilderAuthGroupDirectory): string[] {
  return Array.from(new Set([
    ...directory.actors.flatMap((actor) => actor.groups),
    ...directory.groups.map((group) => group.group),
  ])).filter(Boolean).sort();
}

function emptyBuilderAuthGroupDirectory(): BuilderAuthGroupDirectory {
  return { actors: [], groups: [] };
}

function dedupeKeys(keys: BuilderAuthKey[]): BuilderAuthKey[] {
  const byId = new Map<string, BuilderAuthKey>();
  for (const key of keys) {
    byId.set(key.keyId, key);
  }
  return [...byId.values()];
}

function toInventoryKey(key: BuilderAuthKey): BuilderAuthInventoryKey {
  return {
    keyId: key.keyId,
    actorId: key.actorId,
    name: key.name,
    role: key.role,
    groups: key.groups,
    areas: key.areas,
    scopes: key.scopes,
    source: key.source,
    disabled: key.disabled,
    expired: isExpired(key.expiresAt),
    expiresAt: key.expiresAt,
    hashPrefix: key.keyHash.slice(0, 10),
  };
}

function readDirectProvidedKey(headers: HeaderBag): string {
  return firstHeader(headers, ["x-agent-flow-builder-key", "x-agent-builder-api-key", "x-api-key"]);
}

function readBearerToken(headers: HeaderBag): string {
  const authorization = firstHeader(headers, ["authorization"]);
  if (!authorization) {
    return "";
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() ?? "";
}

function looksLikeJwt(value: string): boolean {
  return value.split(".").length === 3;
}

function firstHeader(headers: HeaderBag, names: string[]): string {
  for (const name of names) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const first = value.find((item) => item.trim());
      if (first) {
        return first.trim();
      }
    }
  }
  return "";
}

function firstString(value: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
  }
  return "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item).trim()).filter(Boolean))).sort();
  }
  if (typeof value === "string") {
    return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean))).sort();
  }
  return [];
}

function normalizeOidcScopes(value: string | undefined): string[] {
  const raw = typeof value === "string" && value.trim() ? value : "openid profile email";
  const scopes = raw
    .split(/[,\s]+/g)
    .map((scope) => scope.trim())
    .filter(Boolean);
  const deduped = Array.from(new Set(scopes));
  return deduped.includes("openid") ? deduped : ["openid", ...deduped];
}

function normalizeId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "local-studio";
}

function normalizeHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : "";
}

function normalizeDate(value: string): string | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function isExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= Date.now();
}

function builderAuthSessionTtlSeconds(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.AGENT_FLOW_BUILDER_AUTH_SESSION_TTL_SECONDS ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 8 * 60 * 60;
  }
  return Math.max(60, Math.min(Math.floor(parsed), 24 * 60 * 60));
}

function builderAuthOidcFlowTtlSeconds(env: NodeJS.ProcessEnv): number {
  const parsed = Number(env.AGENT_FLOW_BUILDER_AUTH_OIDC_FLOW_TTL_SECONDS ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5 * 60;
  }
  return Math.max(60, Math.min(Math.floor(parsed), 15 * 60));
}

function builderAuthSessionPersistencePath(env: NodeJS.ProcessEnv): string {
  return env.AGENT_FLOW_BUILDER_AUTH_SESSION_PATH?.trim() || "";
}

function loadPersistentBuilderAuthSessions(sessionPath: string): BuilderAuthPersistentSessionRecord[] {
  if (!sessionPath || !existsSync(sessionPath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(sessionPath, "utf-8")) as unknown;
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.sessions)
        ? parsed.sessions
        : [];
    return entries
      .map(normalizePersistentBuilderAuthSession)
      .filter((entry): entry is BuilderAuthPersistentSessionRecord => entry !== null);
  } catch {
    return [];
  }
}

function normalizePersistentBuilderAuthSession(value: unknown): BuilderAuthPersistentSessionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const tokenHash = normalizeHash(firstString(value, ["tokenHash", "token_hash", "sessionHash", "session_hash"]));
  const expiresAt = normalizeDate(firstString(value, ["expiresAt", "expires_at"]));
  const identityRaw = isRecord(value.identity) ? value.identity : {};
  const actorId = normalizeId(firstString(identityRaw, ["actorId", "actor_id", "sub"]));
  if (!tokenHash || !expiresAt || !actorId || isExpired(expiresAt)) {
    return null;
  }
  const identity: BuilderAuthIdentity = {
    keyId: normalizeId(firstString(identityRaw, ["keyId", "key_id", "id"])) || `session-${tokenHash.slice(0, 8)}`,
    actorId,
    name: firstString(identityRaw, ["name", "displayName", "display_name"]) || actorId,
    role: firstString(identityRaw, ["role"]) || "viewer",
    groups: normalizeStringList(identityRaw.groups),
    areas: normalizeStringList(identityRaw.areas).length ? normalizeStringList(identityRaw.areas) : ["*"],
    scopes: normalizeStringList(identityRaw.scopes).length ? normalizeStringList(identityRaw.scopes) : ["workspace:read"],
    source: "session",
    expiresAt,
  };
  return {
    tokenHash,
    identity,
    expiresAt,
    createdAt: normalizeDate(firstString(value, ["createdAt", "created_at"])) ?? new Date().toISOString(),
    hasProviderLogoutHint: value.hasProviderLogoutHint === true,
    hasProviderRefreshToken: value.hasProviderRefreshToken === true,
  };
}

function sanitizePersistentBuilderAuthSessionIdentity(
  identity: BuilderAuthIdentity,
  expiresAt: string,
): BuilderAuthIdentity {
  return {
    keyId: identity.keyId,
    actorId: identity.actorId,
    name: identity.name,
    role: identity.role,
    groups: identity.groups,
    areas: identity.areas,
    scopes: identity.scopes,
    source: "session",
    expiresAt,
  };
}

function builderAuthSessionServiceConfig(env: NodeJS.ProcessEnv): BuilderAuthSessionServiceConfig {
  const rawUrl = env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL?.trim() || "";
  const token = env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN?.trim() || "";
  const timeoutMs = normalizeBuilderAuthSessionServiceTimeoutMs(env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TIMEOUT_MS);
  if (!rawUrl) {
    return {
      configured: false,
      urlConfigured: false,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: null,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: "URL inválida.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: "Use http ou https.",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      invalidReason: "URL não deve conter usuário ou senha.",
    };
  }
  parsed.hash = "";
  return {
    configured: true,
    urlConfigured: true,
    url: parsed.toString(),
    token,
    tokenConfigured: Boolean(token),
    timeoutMs,
    invalidReason: null,
  };
}

function builderAuthSessionIntrospectionConfig(env: NodeJS.ProcessEnv): BuilderAuthSessionIntrospectionConfig {
  const rawUrl = env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL?.trim() || "";
  const token = env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN?.trim() || "";
  const timeoutMs = normalizeBuilderAuthSessionServiceTimeoutMs(env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TIMEOUT_MS);
  const required = env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_REQUIRED === "true";
  if (!rawUrl) {
    return {
      configured: false,
      urlConfigured: false,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      required,
      invalidReason: null,
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      required,
      invalidReason: "URL inválida.",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      required,
      invalidReason: "Use http ou https.",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      configured: false,
      urlConfigured: true,
      url: "",
      token,
      tokenConfigured: Boolean(token),
      timeoutMs,
      required,
      invalidReason: "URL não deve conter usuário ou senha.",
    };
  }
  parsed.hash = "";
  return {
    configured: true,
    urlConfigured: true,
    url: parsed.toString(),
    token,
    tokenConfigured: Boolean(token),
    timeoutMs,
    required,
    invalidReason: null,
  };
}

function normalizeBuilderAuthSessionServiceTimeoutMs(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 2000;
  }
  return Math.max(250, Math.min(10000, Math.floor(parsed)));
}

async function sendBuilderAuthSessionServiceEvent(input: {
  config: BuilderAuthSessionServiceConfig;
  action: BuilderAuthSessionServiceAction;
  tokenHash: string;
  previousTokenHash: string | null;
  session: BuilderAuthSessionRecord | null;
  ttlSeconds: number;
  revoked: boolean | null;
}): Promise<void> {
  if (!input.config.configured) {
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.config.token) {
      headers.authorization = `Bearer ${input.config.token}`;
    }
    const event: BuilderAuthSessionServiceEvent = {
      format: "agent-flow-builder.builder-auth-session-service-event.v1",
      generatedAt: new Date().toISOString(),
      action: input.action,
      session: {
        tokenHash: input.tokenHash,
        previousTokenHash: input.previousTokenHash,
        identity: input.session ? sanitizePersistentBuilderAuthSessionIdentity(input.session.identity, input.session.expiresAt) : null,
        expiresAt: input.session?.expiresAt ?? null,
        ttlSeconds: input.ttlSeconds,
        revoked: input.revoked,
        hasProviderLogoutHint: Boolean(input.session?.oidcIdTokenHint),
        hasProviderRefreshToken: Boolean(input.session?.oidcRefreshToken),
      },
      governance: {
        sendsTokenHash: true,
        sendsRawToken: false,
        sendsProviderTokens: false,
        sendsRawKeyValues: false,
        serviceAuthTokenInBody: false,
      },
    };
    await fetch(input.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch {
    // Session service sync is optional; local Builder sessions must keep working without it.
  } finally {
    clearTimeout(timeout);
  }
}

async function introspectBuilderAuthSession(input: {
  config: BuilderAuthSessionIntrospectionConfig;
  tokenHash: string;
  session: BuilderAuthSessionRecord;
}): Promise<BuilderAuthSessionIntrospectionDecision> {
  if (!input.config.configured) {
    if (input.config.required) {
      return {
        status: "rejected",
        reason: input.config.invalidReason
          ? `Introspecção central de sessão do Builder inválida: ${input.config.invalidReason}`
          : "Introspecção central de sessão do Builder obrigatória, mas não configurada.",
      };
    }
    return { status: "skipped" };
  }
  const localIdentity = sanitizePersistentBuilderAuthSessionIdentity(input.session.identity, input.session.expiresAt);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.config.token) {
      headers.authorization = `Bearer ${input.config.token}`;
    }
    const request: BuilderAuthSessionIntrospectionRequest = {
      format: "agent-flow-builder.builder-auth-session-introspection-request.v1",
      generatedAt: new Date().toISOString(),
      session: {
        tokenHash: input.tokenHash,
        localIdentity,
        localExpiresAt: input.session.expiresAt,
        hasLocalSession: true,
        hasProviderLogoutHint: Boolean(input.session.oidcIdTokenHint),
        hasProviderRefreshToken: Boolean(input.session.oidcRefreshToken),
      },
      governance: {
        sendsTokenHash: true,
        sendsRawToken: false,
        sendsProviderTokens: false,
        sendsRawKeyValues: false,
        serviceAuthTokenInBody: false,
        centralDecisionCanOverrideIdentity: true,
      },
    };
    const response = await fetch(input.config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      return input.config.required
        ? { status: "rejected", reason: `Introspecção central de sessão do Builder rejeitou a consulta com HTTP ${response.status}.` }
        : { status: "skipped" };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      return input.config.required
        ? { status: "rejected", reason: "Introspecção central de sessão do Builder retornou JSON inválido." }
        : { status: "skipped" };
    }
    return normalizeBuilderAuthSessionIntrospectionDecision(body, localIdentity, input.session.expiresAt, input.config.required);
  } catch {
    return input.config.required
      ? { status: "rejected", reason: "Introspecção central de sessão do Builder indisponível." }
      : { status: "skipped" };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBuilderAuthSessionIntrospectionDecision(
  value: unknown,
  localIdentity: BuilderAuthIdentity,
  localExpiresAt: string,
  required: boolean,
): BuilderAuthSessionIntrospectionDecision {
  if (!isRecord(value)) {
    return required
      ? { status: "rejected", reason: "Introspecção central de sessão do Builder retornou resposta inválida." }
      : { status: "skipped" };
  }
  const status = typeof value.status === "string" ? value.status.trim().toLowerCase() : "";
  const allowed = value.allowed === true || status === "allowed" || status === "authenticated";
  const denied = value.allowed === false || status === "rejected" || status === "denied" || status === "blocked";
  const reason = firstString(value, ["reason", "message", "detail"]) || "Decisão central de sessão do Builder negou a sessão.";
  if (denied) {
    return { status: "rejected", reason };
  }
  if (!allowed) {
    return required
      ? { status: "rejected", reason: "Introspecção central de sessão do Builder não retornou decisão allow explícita." }
      : { status: "skipped" };
  }
  const identity = normalizeCentralBuilderAuthSessionIdentity(localIdentity, isRecord(value.identity) ? value.identity : {}, localExpiresAt);
  if (isExpired(identity.expiresAt)) {
    return { status: "rejected", reason: "Introspecção central de sessão do Builder retornou sessão expirada." };
  }
  return { status: "authenticated", identity };
}

function normalizeCentralBuilderAuthSessionIdentity(
  localIdentity: BuilderAuthIdentity,
  value: Record<string, unknown>,
  localExpiresAt: string,
): BuilderAuthIdentity {
  const rawActorId = firstString(value, ["actorId", "actor_id", "sub"]);
  const actorId = rawActorId ? normalizeId(rawActorId) : localIdentity.actorId;
  const groups = Object.prototype.hasOwnProperty.call(value, "groups") ? normalizeStringList(value.groups) : localIdentity.groups;
  const areas = Object.prototype.hasOwnProperty.call(value, "areas") ? normalizeStringList(value.areas) : localIdentity.areas;
  const scopes = Object.prototype.hasOwnProperty.call(value, "scopes") ? normalizeStringList(value.scopes) : localIdentity.scopes;
  const expiresAt = normalizeDate(firstString(value, ["expiresAt", "expires_at"])) ?? localExpiresAt;
  return {
    keyId: firstString(value, ["keyId", "key_id", "id"]) ? normalizeId(firstString(value, ["keyId", "key_id", "id"])) : localIdentity.keyId,
    actorId,
    name: firstString(value, ["name", "displayName", "display_name"]) || localIdentity.name || actorId,
    role: Object.prototype.hasOwnProperty.call(value, "role") ? normalizeJwtRole(value.role) : localIdentity.role,
    groups,
    areas: areas.length ? areas : ["*"],
    scopes: scopes.length ? scopes : ["workspace:read"],
    source: "central-session",
    expiresAt,
  };
}

function pruneExpiredSessions(sessions: Map<string, { expiresAt: string }>): void {
  const now = Date.now();
  for (const [hash, session] of sessions.entries()) {
    if (Date.parse(session.expiresAt) <= now) {
      sessions.delete(hash);
    }
  }
}

function pruneExpiredOidcFlows(flows: Map<string, { expiresAt: string }>): void {
  const now = Date.now();
  for (const [hash, flow] of flows.entries()) {
    if (Date.parse(flow.expiresAt) <= now) {
      flows.delete(hash);
    }
  }
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const BUILDER_AUTH_ROLE_RANK: Record<BuilderAuthRole, number> = {
  viewer: 0,
  reviewer: 1,
  operator: 2,
  owner: 3,
};

function normalizeBuilderAuthRole(value: string): BuilderAuthRole {
  const normalized = value.trim().toLowerCase();
  return normalized === "owner" || normalized === "operator" || normalized === "reviewer" || normalized === "viewer"
    ? normalized
    : "viewer";
}

function maxBuilderAuthRole(first: BuilderAuthRole, ...rest: BuilderAuthRole[]): BuilderAuthRole {
  return [first, ...rest].sort((left, right) => BUILDER_AUTH_ROLE_RANK[right] - BUILDER_AUTH_ROLE_RANK[left])[0] ?? first;
}

function mergeBuilderAuthStringSets(
  first: string[],
  second: string[],
  fallback: string[],
): string[] {
  const merged = Array.from(new Set([...first, ...second].map((item) => item.trim()).filter(Boolean))).sort();
  return merged.length ? merged : fallback;
}

function normalizeGroupPolicyGroup(value: string): string {
  return value.trim().toLowerCase();
}

function base64UrlEncode(value: Buffer | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

function safeEqualHex(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
