import logger from '../../utils/logger';

describe('logger test output hygiene', () => {
  const testLogsEnv = 'EXPO_LITE_DATA_STORE_TEST_LOGS';
  const originalValue = process.env[testLogsEnv];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[testLogsEnv];
    } else {
      process.env[testLogsEnv] = originalValue;
    }
    jest.restoreAllMocks();
  });

  it('suppresses library logs in test mode unless explicitly enabled', () => {
    delete process.env[testLogsEnv];
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    logger.success('success');
    logger.info('info');
    logger.debug('debug');
    logger.highlight('highlight');
    logger.warn('warn');
    logger.error('error');

    expect(log).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('allows explicit test log diagnostics', () => {
    process.env[testLogsEnv] = '1';
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    logger.info('diagnostic');
    logger.warn('diagnostic warning');
    logger.error('diagnostic error');

    expect(log).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
