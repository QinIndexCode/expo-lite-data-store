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
