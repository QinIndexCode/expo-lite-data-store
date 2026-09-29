import { ensureStorageRootReady, getRootPath } from '../../utils/ROOTPath';
import { getFileSystem } from '../../utils/fileSystemCompat';
import logger from '../../utils/logger';

/**
 * Persists the active storage engine under the storage root.
 *
 * `configManager` keeps the engine choice in memory only, so a migration to
 * SQLite was silently reverted to the file-system engine on the next launch —
 * with `cleanSource: true` that presented as total data loss. The marker file
 * survives restarts; an explicit runtime engine choice (setConfig / init
 * option) always takes precedence over the marker.
 */
export type PersistedEngine = 'file-system' | 'sqlite';

const ENGINE_MARKER_FILE = 'storage-engine.marker';
const VALID_PERSISTED_ENGINES: readonly string[] = ['file-system', 'sqlite'];

const getMarkerUri = async (): Promise<string> => {
  await ensureStorageRootReady();
  const rootPath = await getRootPath();
  return `${rootPath}${ENGINE_MARKER_FILE}`;
};

/** Returns the persisted engine preference, or null when absent/unreadable. */
export const readPersistedEnginePreference = async (): Promise<PersistedEngine | null> => {
  try {
    const fileSystem = getFileSystem();
    const uri = await getMarkerUri();
    const info = await fileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory) {
      return null;
    }
    const contents = (await fileSystem.readAsStringAsync(uri)).trim();
    return VALID_PERSISTED_ENGINES.includes(contents) ? (contents as PersistedEngine) : null;
  } catch {
    return null;
  }
};

export const writePersistedEnginePreference = async (engine: PersistedEngine): Promise<void> => {
  const fileSystem = getFileSystem();
  const uri = await getMarkerUri();
  await fileSystem.writeAsStringAsync(uri, engine);
  logger.info(`[EnginePreference] Persisted storage engine preference: ${engine}`);
};

export const clearPersistedEnginePreference = async (): Promise<void> => {
  try {
    const fileSystem = getFileSystem();
    const uri = await getMarkerUri();
    await fileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Nothing to clear, or the marker is already gone; the next read falls
    // back to the configured/default engine.
  }
};
