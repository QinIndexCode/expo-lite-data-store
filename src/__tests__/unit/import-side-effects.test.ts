describe('import side effects', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not instantiate runtime services when the package is only imported', () => {
    jest.isolateModules(() => {
      const autoSyncModule = require('../../core/service/AutoSyncService');
      const taskQueueModule = require('../../taskQueue/taskQueue');

      const getInstanceSpy = jest.spyOn(autoSyncModule.AutoSyncService, 'getInstance');
      const taskQueueStartSpy = jest.spyOn(taskQueueModule.taskQueue, 'start');

      require('../../expo-lite-data-store');

      expect(getInstanceSpy).not.toHaveBeenCalled();
      expect(taskQueueStartSpy).not.toHaveBeenCalled();
    });
  });
});
