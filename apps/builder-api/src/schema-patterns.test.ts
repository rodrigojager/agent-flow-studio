import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compareSchemaPatternConflictReview,
  loadSchemaPatternConflictReview,
  loadSchemaPatternLibrary,
  mergeSchemaPatternLibrary,
  resolveSchemaPatternLibraryConflict,
  saveSchemaPatternLibrary,
} from "./schema-patterns.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createWorkspaceFixture(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-schema-patterns-"));
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

test("schema pattern curation threads expose compact event history", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const schema = {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string" },
    },
  };
  const firstPattern = {
    id: "schema-pattern-curation-events",
    name: "Eventos de curadoria",
    description: "Contrato reutilizavel com auditoria compacta.",
    tags: ["curadoria"],
    curationStatus: "draft",
    createdAt: "2026-07-02T02:00:00.000Z",
    updatedAt: "2026-07-02T02:00:00.000Z",
    usageCount: 0,
    schema,
    curationReviews: [
      {
        id: "review-schema-events",
        reviewer: "schema-reviewer",
        role: "reviewer",
        decision: "request_changes",
        note: "Solicitou ajuste no contrato reutilizavel.",
        createdAt: "2026-07-02T02:02:00.000Z",
        schemaHash: "schema-events",
        assessmentStatus: "review",
        assessmentScore: 72,
      },
    ],
    curationThread: {
      status: "unassigned",
      assignee: "",
      openedAt: "2026-07-02T02:00:00.000Z",
      updatedAt: "2026-07-02T02:03:00.000Z",
      schemaHash: "schema-events",
      events: [
        {
          id: "schema-thread-assign",
          at: "2026-07-02T02:01:00.000Z",
          actor: "schema-curator",
          action: "assign",
          assignee: "schema-curator",
          note: "Assumiu a curadoria.",
          schemaHash: "schema-events",
        },
        {
          id: "schema-thread-release",
          at: "2026-07-02T02:03:00.000Z",
          actor: "schema-curator",
          action: "release",
          assignee: "",
          note: "x".repeat(320),
          schemaHash: "schema-events",
        },
        {
          id: "schema-thread-invalid",
          at: "2026-07-02T02:04:00.000Z",
          actor: "schema-curator",
          action: "raw_schema_dump",
        },
      ],
    },
  };
  const secondPattern = {
    ...firstPattern,
    updatedAt: "2026-07-02T02:04:00.000Z",
    curationReviews: [],
    curationThread: {
      status: "assigned",
      assignee: "schema-curator-2",
      openedAt: "2026-07-02T02:00:00.000Z",
      updatedAt: "2026-07-02T02:04:00.000Z",
      schemaHash: "schema-events",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      leaseDurationHours: 24,
      leaseExpired: false,
      events: [
        {
          id: "schema-thread-reassign",
          at: "2026-07-02T02:04:00.000Z",
          actor: "schema-curator-2",
          action: "assign",
          assignee: "schema-curator-2",
          note: "Reassumiu sem schema bruto.",
          schemaHash: "schema-events",
        },
      ],
    },
  };
  const expiredPattern = {
    id: "schema-pattern-expired-lease",
    name: "Lease expirado",
    description: "Contrato reutilizavel com lease antigo.",
    tags: ["curadoria"],
    curationStatus: "draft",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    usageCount: 0,
    schema,
    curationReviews: [],
    curationThread: {
      status: "assigned",
      assignee: "stale-schema-curator",
      openedAt: "2020-01-01T00:00:00.000Z",
      updatedAt: "2020-01-01T00:00:00.000Z",
      schemaHash: "schema-expired",
      leaseExpiresAt: "2020-01-01T01:00:00.000Z",
      leaseDurationHours: 1,
      leaseExpired: false,
      events: [
        {
          id: "schema-thread-stale-assign",
          at: "2020-01-01T00:00:00.000Z",
          actor: "stale-schema-curator",
          action: "assign",
          assignee: "stale-schema-curator",
          note: "Assumiu e abandonou.",
          schemaHash: "schema-expired",
        },
      ],
    },
  };

  const saved = await saveSchemaPatternLibrary(workspaceRoot, "reference-interview", {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: "2026-07-02T02:05:00.000Z",
    items: [firstPattern, secondPattern, expiredPattern],
  });

  assert.equal(saved.itemCount, 2);
  const savedPattern = saved.items.find((item) => item.id === "schema-pattern-curation-events");
  assert.ok(savedPattern);
  const thread = savedPattern.curationThread;
  assert.ok(thread);
  assert.equal(thread.events.length, 4);
  assert.deepEqual(thread.events.map((event) => event.action), ["assign", "release", "review", "assign"]);
  assert.equal(thread.events[0].actor, "schema-curator-2");
  assert.equal(thread.events[1].note.length, 240);
  assert.equal(thread.events[2].decision, "request_changes");
  assert.ok(thread.leaseExpiresAt);
  assert.match(thread.leaseExpiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(thread.leaseDurationHours, 24);
  assert.equal(thread.leaseExpired, false);
  assert.equal(thread.governance.autoReleasesExpiredAssignments, true);
  assert.equal(thread.governance.configuredLeaseHoursEnv, "AGENT_FLOW_SCHEMA_PATTERN_CURATION_LEASE_HOURS");
  assert.equal(JSON.stringify(thread.events).includes("raw_schema_dump"), false);

  const expiredThread = saved.items.find((item) => item.id === "schema-pattern-expired-lease")?.curationThread;
  assert.ok(expiredThread);
  assert.equal(expiredThread.status, "unassigned");
  assert.equal(expiredThread.assignee, "");
  assert.equal(expiredThread.leaseExpiresAt, null);
  assert.equal(expiredThread.leaseDurationHours, null);
  assert.equal(expiredThread.leaseExpired, true);
  assert.equal(expiredThread.events.some((event) => event.action === "lease_expired"), true);

  const loaded = await loadSchemaPatternLibrary(workspaceRoot, "reference-interview");
  const loadedPattern = loaded.items.find((item) => item.id === "schema-pattern-curation-events");
  assert.ok(loadedPattern?.curationThread);
  assert.deepEqual(loadedPattern.curationThread.events, thread.events);
});

test("resolved schema pattern conflicts suppress identical discarded replays", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const baseMessagePattern = {
    id: "schema-pattern-shared-message",
    name: "Mensagem compartilhada",
    description: "Contrato de mensagem reutilizavel.",
    tags: ["mensagem", "rag"],
    curationStatus: "approved",
    createdAt: "2026-07-02T00:08:00.000Z",
    updatedAt: "2026-07-02T00:08:00.000Z",
    schemaHash: "schema-a",
    usageCount: 1,
    summary: { propertyCount: 1, definitionCount: 0 },
    schema: {
      type: "object",
      required: ["context", "message"],
      properties: {
        context: { type: "string" },
        message: { type: "string" },
      },
      $defs: {
        ExistingMeta: { type: "object" },
      },
    },
  };

  await saveSchemaPatternLibrary(workspaceRoot, "reference-interview", {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: "2026-07-02T00:08:00.000Z",
    items: [baseMessagePattern],
  });

  const discardedMessagePattern = {
    ...baseMessagePattern,
    tags: ["mensagem", "revisado"],
    updatedAt: "2026-07-02T00:09:00.000Z",
    usageCount: 2,
  };
  const merged = await mergeSchemaPatternLibrary(workspaceRoot, "reference-interview", {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: "2026-07-02T00:09:00.000Z",
    items: [discardedMessagePattern],
  });
  assert.equal(merged.sharedSync.conflictCount, 1);
  assert.equal(merged.openConflictCount, 1);

  const openReview = await loadSchemaPatternConflictReview(workspaceRoot, "reference-interview");
  assert.equal(openReview.format, "agent-flow-builder.schema-pattern-conflict-review.v1");
  assert.equal(openReview.conflictCount, 1);
  assert.equal(openReview.openConflictCount, 1);
  assert.equal(openReview.summary.schemaChangedConflictCount, 0);
  assert.equal(openReview.summary.metadataOnlyConflictCount, 1);
  assert.equal(openReview.resolutionCount, 0);
  assert.equal(openReview.governance.excludesRawSchemaContent, true);
  assert.equal(openReview.governance.excludesLocalRawTextDiff, true);
  assert.equal((openReview as unknown as Record<string, unknown>).items, undefined);
  assert.equal(JSON.stringify(openReview).includes('"schema":'), false);
  assert.equal(JSON.stringify(openReview).includes("rawSchemaTextDiff"), false);

  const resolved = await resolveSchemaPatternLibraryConflict(
    workspaceRoot,
    "reference-interview",
    merged.conflicts[0].id,
    {
      resolvedBy: "schema-curator",
      resolution: "accept_existing_snapshot",
      resolutionNote: "Retomar metadados aprovados anteriormente.",
    },
  );
  assert.equal(resolved.openConflictCount, 0);
  const resolvedMessagePattern = resolved.items.find((item) => item.id === "schema-pattern-shared-message");
  assert.ok(resolvedMessagePattern);
  assert.equal(resolvedMessagePattern.usageCount, 1);
  assert.deepEqual(resolvedMessagePattern.tags, ["mensagem", "rag"]);

  const resolvedReview = await loadSchemaPatternConflictReview(workspaceRoot, "reference-interview");
  assert.equal(resolvedReview.conflictCount, 1);
  assert.equal(resolvedReview.openConflictCount, 0);
  assert.equal(resolvedReview.resolutionCount, 1);
  assert.equal(resolvedReview.resolutions[0].resolution, "accept_existing_snapshot");
  assert.equal(resolvedReview.resolutions[0].resolvedBy, "schema-curator");
  assert.equal(JSON.stringify(resolvedReview).includes('"schema":'), false);

  const reviewDiff = await compareSchemaPatternConflictReview(workspaceRoot, "reference-interview", openReview);
  assert.equal(reviewDiff.format, "agent-flow-builder.schema-pattern-conflict-review-diff.v1");
  assert.equal(reviewDiff.current.openConflictCount, 0);
  assert.equal(reviewDiff.incoming.openConflictCount, 1);
  assert.equal(reviewDiff.governance.excludesRawSchemaContent, true);
  const conflictSection = reviewDiff.sections.find((section) => section.id === "conflicts");
  assert.ok(conflictSection);
  assert.equal(conflictSection.items[0].status, "changed");
  const resolutionSection = reviewDiff.sections.find((section) => section.id === "resolutions");
  assert.ok(resolutionSection);
  assert.equal(resolutionSection.items.some((item) => item.status === "only_current"), true);
  assert.equal(JSON.stringify(reviewDiff).includes('"schema":'), false);

  await assert.rejects(
    () =>
      compareSchemaPatternConflictReview(workspaceRoot, "reference-interview", {
        ...openReview,
        conflicts: [
          {
            ...openReview.conflicts[0],
            existingSnapshot: {
              ...openReview.conflicts[0].existingSnapshot,
              schema: { type: "object" },
            },
          },
        ],
      }),
    /schema bruto/,
  );

  const replayed = await mergeSchemaPatternLibrary(workspaceRoot, "reference-interview", {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: "2026-07-02T00:11:00.000Z",
    items: [
      {
        ...discardedMessagePattern,
        updatedAt: "2026-07-02T00:11:00.000Z",
      },
    ],
  });

  assert.equal(replayed.sharedSync.conflictCount, 0);
  assert.equal(replayed.sharedSync.updatedCount, 0);
  assert.equal(replayed.conflictCount, 1);
  assert.equal(replayed.openConflictCount, 0);
  assert.equal(replayed.conflicts[0].status, "resolved");
  const replayedMessagePattern = replayed.items.find((item) => item.id === "schema-pattern-shared-message");
  assert.ok(replayedMessagePattern);
  assert.equal(replayedMessagePattern.usageCount, 1);
  assert.deepEqual(replayedMessagePattern.tags, ["mensagem", "rag"]);
});

test("schema pattern library structurally merges non-overlapping raw schemas", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const basePattern = {
    id: "schema-pattern-structural-contract",
    name: "Contrato estrutural",
    description: "Contrato reutilizavel com campos acumulados.",
    tags: ["contrato"],
    curationStatus: "approved",
    createdAt: "2026-07-02T01:00:00.000Z",
    updatedAt: "2026-07-02T01:00:00.000Z",
    usageCount: 0,
    schema: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string" },
      },
      $defs: {
        MessageMeta: {
          type: "object",
          properties: {
            lang: { type: "string" },
          },
        },
      },
    },
  };
  await saveSchemaPatternLibrary(workspaceRoot, "reference-interview", {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: "2026-07-02T01:00:00.000Z",
    items: [basePattern],
  });

  const merged = await mergeSchemaPatternLibrary(workspaceRoot, "reference-interview", {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: "2026-07-02T01:05:00.000Z",
    items: [
      {
        ...basePattern,
        updatedAt: "2026-07-02T01:05:00.000Z",
        schema: {
          type: "object",
          required: ["message", "source"],
          properties: {
            message: { type: "string" },
            source: { type: "string" },
          },
          $defs: {
            MessageMeta: {
              type: "object",
              properties: {
                lang: { type: "string" },
              },
            },
            Citation: {
              type: "object",
              properties: {
                url: { type: "string" },
              },
            },
          },
          allOf: [{ required: ["source"] }],
        },
      },
    ],
  });

  assert.equal(merged.sharedSync.conflictCount, 0);
  assert.equal(merged.sharedSync.updatedCount, 1);
  assert.equal(merged.conflictCount, 0);
  assert.equal(merged.openConflictCount, 0);
  const mergedPattern = merged.items.find((item) => item.id === "schema-pattern-structural-contract");
  assert.ok(mergedPattern);
  const mergedSchema = mergedPattern.schema as Record<string, unknown>;
  const properties = mergedSchema.properties as Record<string, unknown>;
  const definitions = mergedSchema.$defs as Record<string, unknown>;
  assert.ok(properties.message);
  assert.ok(properties.source);
  assert.ok(definitions.MessageMeta);
  assert.ok(definitions.Citation);
  assert.deepEqual(mergedSchema.required, ["message", "source"]);
  assert.deepEqual(mergedSchema.allOf, [{ required: ["source"] }]);
  assert.match(mergedPattern.schemaHash, /^[a-f0-9]{8}$/);
  assert.equal((mergedPattern.summary as Record<string, unknown>).propertyCount, 4);
  assert.equal((mergedPattern.summary as Record<string, unknown>).definitionCount, 2);
});

test("schema pattern structural merge leaves raw schema collisions as conflicts", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const basePattern = {
    id: "schema-pattern-structural-collision",
    name: "Contrato com colisao",
    description: "Contrato reutilizavel com conflito real.",
    tags: ["contrato"],
    curationStatus: "approved",
    createdAt: "2026-07-02T02:00:00.000Z",
    updatedAt: "2026-07-02T02:00:00.000Z",
    usageCount: 0,
    schema: {
      type: "object",
      required: ["context", "message"],
      properties: {
        context: { type: "string" },
        message: { type: "string" },
      },
      $defs: {
        ExistingMeta: { type: "object" },
      },
    },
  };
  await saveSchemaPatternLibrary(workspaceRoot, "reference-interview", {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: "2026-07-02T02:00:00.000Z",
    items: [basePattern],
  });

  const merged = await mergeSchemaPatternLibrary(workspaceRoot, "reference-interview", {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: "2026-07-02T02:05:00.000Z",
    items: [
      {
        ...basePattern,
        updatedAt: "2026-07-02T02:05:00.000Z",
        schema: {
          type: "object",
          required: ["message", "priority"],
          properties: {
            message: { type: "number" },
            priority: { type: "number" },
          },
          $defs: {
            IncomingMeta: { type: "object" },
          },
        },
      },
    ],
  });

  assert.equal(merged.sharedSync.conflictCount, 1);
  assert.equal(merged.conflictCount, 1);
  assert.equal(merged.openConflictCount, 1);
  assert.equal(merged.conflicts[0].reason, "schema");
  assert.equal(merged.conflicts[0].schemaMergePlan.canAutoMerge, false);
  assert.equal(merged.conflicts[0].schemaMergePlan.schemaChanged, true);
  assert.deepEqual(merged.conflicts[0].schemaMergePlan.propertyConflicts, ["message"]);
  assert.deepEqual(merged.conflicts[0].schemaMergePlan.propertyAdditions, ["priority"]);
  assert.deepEqual(merged.conflicts[0].schemaMergePlan.propertyExistingOnly, ["context"]);
  assert.deepEqual(merged.conflicts[0].schemaMergePlan.definitionAdditions, ["IncomingMeta"]);
  assert.deepEqual(merged.conflicts[0].schemaMergePlan.definitionExistingOnly, ["ExistingMeta"]);
  assert.deepEqual(merged.conflicts[0].schemaMergePlan.requiredAdditions, ["priority"]);
  assert.deepEqual(merged.conflicts[0].schemaMergePlan.requiredExistingOnly, ["context"]);
  assert.equal(merged.conflicts[0].schemaMergePlan.governance.excludesRawSchemaContent, true);
  assert.equal(JSON.stringify(merged.conflicts[0].schemaMergePlan).includes('"schema"'), false);
  assert.equal(merged.conflicts[0].rawSchemaTextDiff?.governance.localOnly, true);
  assert.equal(merged.conflicts[0].rawSchemaTextDiff?.governance.containsRawSchemaContent, true);
  assert.equal(merged.conflicts[0].rawSchemaTextDiff?.existingSchemaHash, merged.conflicts[0].existingSnapshot.schemaHash);
  assert.equal(merged.conflicts[0].rawSchemaTextDiff?.incomingSchemaHash, merged.conflicts[0].incomingSnapshot.schemaHash);
  assert.ok(merged.conflicts[0].rawSchemaTextDiff?.rows.some((row) => row.rightText.includes('"priority"')));
  const stored = await loadSchemaPatternLibrary(workspaceRoot, "reference-interview");
  assert.equal(stored.conflicts[0].rawSchemaTextDiff, undefined);

  const resolved = await resolveSchemaPatternLibraryConflict(
    workspaceRoot,
    "reference-interview",
    merged.conflicts[0].id,
    {
      resolvedBy: "schema-curator",
      resolution: "apply_manual_schema_merge",
      resolutionNote: "Aplicar schema mesclado pelo editor visual.",
      mergedSchema: {
        type: "object",
        required: ["message", "priority"],
        properties: {
          message: { type: "string" },
          priority: { type: "number" },
        },
      },
    },
  );
  assert.equal(resolved.openConflictCount, 0);
  assert.equal(resolved.conflicts[0].status, "resolved");
  assert.equal(resolved.conflicts[0].resolution, "apply_manual_schema_merge");
  assert.equal(resolved.conflicts[0].resolutionPlan?.schemaContentAction, "manual_schema_merge_applied");
  assert.equal(resolved.conflicts[0].resolutionPlan?.metadataAction, "current_metadata_retained");
  assert.equal(resolved.conflicts[0].resolutionPlan?.requiresManualSchemaReview, false);
  assert.equal(JSON.stringify(resolved.conflicts[0]).includes('"schema":{"'), false);
  const resolvedPattern = resolved.items.find((item) => item.id === "schema-pattern-structural-collision");
  assert.ok(resolvedPattern);
  assert.deepEqual(resolvedPattern.schema.required, ["message", "priority"]);
  assert.match(resolvedPattern.schemaHash, /^[a-f0-9]{8}$/);
  assert.equal((resolvedPattern.summary as Record<string, unknown>).propertyCount, 2);
});
