/**
 * @module ROOTPath
 * @description Runtime root path helpers
 * @since 2025-11-19
 * @version 2.0.0
 */

import { pathHelper } from './PathHelper';

export const getRootPath = async (): Promise<string> => {
  return pathHelper.getRootPath();
};

export const getRootPathSync = (): string => {
  return pathHelper.getRootPathSync();
};

export const ensureStorageRootReady = async (): Promise<string> => {
  return pathHelper.ensureStorageReady();
};

export const resetRootPathState = (): void => {
  pathHelper.reset();
};

export default getRootPathSync;
