export function loadProviderTelemetryAlerts(workspaceRoot: string, flowId: string): Promise<unknown>;
export function loadProviderTelemetryAlertsCentralSyncStatus(): Promise<unknown>;
export function loadProviderTelemetryAlertDispatchStatus(): Promise<unknown>;
export function loadProviderTelemetryAlertDeliveryReadiness(workspaceRoot: string, flowId: string): Promise<unknown>;
export function saveProviderTelemetryAlerts(workspaceRoot: string, flowId: string, payload: unknown): Promise<unknown>;
export function mergeProviderTelemetryAlerts(workspaceRoot: string, flowId: string, payload: unknown): Promise<unknown>;
export function syncCentralProviderTelemetryAlerts(workspaceRoot: string, flowId: string): Promise<unknown>;
export function dispatchProviderTelemetryAlerts(workspaceRoot: string, flowId: string): Promise<unknown>;
