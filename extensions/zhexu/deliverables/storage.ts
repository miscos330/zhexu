import type { AgentSessionMaterial } from '@openmaic/storage';
import {
  getAgentSessionMaterialStore,
  removeSessionMaterialRawAsset,
  storeSessionMaterialRawAsset,
} from '@/lib/server/agent-runtime/session-materials';

export interface PersistDeliverableInput {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  /** What the file was made from. It lets a later run find and reuse the file. */
  sourceUrl?: string;
}

/**
 * Save one file of a handout as a material of the session.
 *
 * Upstream's `createSourceMaterial` does the same for an uploaded file but has
 * no way to record where the file came from. The material table already has
 * that column, so this goes through the same byte store and the same table and
 * only adds the value. When the row cannot be written, the bytes are removed
 * again unless the row turns out to exist after all.
 */
export async function persistDeliverableMaterial(
  sessionId: string,
  input: PersistDeliverableInput,
): Promise<AgentSessionMaterial> {
  const rawAssetId = await storeSessionMaterialRawAsset(
    sessionId,
    Buffer.from(input.bytes),
    input.mimeType,
  );
  const store = await getAgentSessionMaterialStore();
  try {
    return await store.createMaterial(sessionId, {
      kind: 'source',
      title: input.filename,
      rawAssetId,
      textChars: 0,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    });
  } catch (error) {
    const rows = await store.listMaterials(sessionId, { limit: 100 }).catch(() => undefined);
    if (rows && !rows.some((row) => row.rawAssetId === rawAssetId))
      await removeSessionMaterialRawAsset(sessionId, rawAssetId).catch(() => undefined);
    throw error;
  }
}
