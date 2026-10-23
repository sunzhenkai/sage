/**
 * Pure helpers for provider connections that expose several models.
 * A connection keeps one default `modelId` plus an allowed `models` list (the
 * default is always part of it); chat selections address one (connection, model) pair.
 */

/** Mirrors the agent-api limits (PROVIDER_CONNECTION_MAX_MODELS / model id length). */
export const MAX_CONNECTION_MODELS = 64;
export const MAX_MODEL_ID_LENGTH = 256;

/** Default model first, then the remaining ids in order — trimmed, de-duplicated, blanks dropped. */
export function connectionModelList(modelId: string, models: readonly string[] | undefined): string[] {
  const result: string[] = [];
  for (const raw of [modelId, ...(models ?? [])]) {
    const id = raw.trim();
    if (id !== '' && !result.includes(id)) result.push(id);
  }
  return result;
}

/** Additional (non-default) models of a connection, in display order. */
export function extraModels(modelId: string, models: readonly string[] | undefined): string[] {
  return connectionModelList(modelId, models).filter((id) => id !== modelId.trim());
}

/** Adds a model id; returns the same list when it is blank, too long, already present or over the cap. */
export function addModel(modelId: string, extras: readonly string[], candidate: string): string[] {
  const id = candidate.trim();
  const current = connectionModelList(modelId, extras);
  if (id === '' || id.length > MAX_MODEL_ID_LENGTH || current.includes(id) || current.length >= MAX_CONNECTION_MODELS) return [...extras];
  return [...extras, id];
}

/** Promotes `next` to default; the previous default stays allowed as an extra model. */
export function promoteDefault(modelId: string, extras: readonly string[], next: string): { modelId: string; extras: string[] } {
  const all = connectionModelList(modelId, extras);
  if (!all.includes(next)) return { modelId, extras: [...extras] };
  return { modelId: next, extras: all.filter((id) => id !== next) };
}

export interface ChatModelSelection { connectionId: string; modelId?: string | undefined }

/** Picker option key for a (connection, model) pair; connection ids are server-generated and never contain a newline. */
export const selectionKey = (connectionId: string, modelId: string): string => `${connectionId}\n${modelId}`;

export function parseSelectionKey(key: string): ChatModelSelection | undefined {
  if (key === '') return undefined;
  const at = key.indexOf('\n');
  if (at < 0) return { connectionId: key };
  const connectionId = key.slice(0, at);
  const modelId = key.slice(at + 1);
  return connectionId === '' ? undefined : { connectionId, ...(modelId === '' ? {} : { modelId }) };
}

export interface PickerConnection { id: string; name: string; available: boolean; modelId?: string | undefined; models?: readonly string[] | undefined }
export interface PickerOption { key: string; connectionId: string; connectionName: string; modelId?: string | undefined; label: string; isDefault: boolean; disabled: boolean }

/**
 * Flattens connections into grouped picker options: one option per allowed model,
 * labeled `connection / model`. Connections without model metadata (older API) fall back to one option.
 */
export function pickerOptions(connections: readonly PickerConnection[]): PickerOption[] {
  return connections.flatMap((connection): PickerOption[] => {
    if (connection.modelId === undefined || connection.modelId.trim() === '') {
      return [{ key: connection.id, connectionId: connection.id, connectionName: connection.name, label: connection.name, isDefault: true, disabled: !connection.available }];
    }
    return connectionModelList(connection.modelId, connection.models).map((modelId) => ({
      key: selectionKey(connection.id, modelId),
      connectionId: connection.id,
      connectionName: connection.name,
      modelId,
      label: `${connection.name} / ${modelId}`,
      isDefault: modelId === connection.modelId,
      disabled: !connection.available
    }));
  });
}

/** Initial picker key: the default connection's default model, when that connection is listed. */
export function defaultSelectionKey(connections: readonly PickerConnection[], defaultConnectionId: string | undefined): string {
  if (defaultConnectionId === undefined) return '';
  const option = pickerOptions(connections).find((item) => item.connectionId === defaultConnectionId && item.isDefault);
  return option?.key ?? '';
}
