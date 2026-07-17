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

  it('suppresses non-critical logs in test mode unless explicitly enabled', () => {
    delete process.env[testLogsEnv];
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});

    logger.success('success');
    logger.info('info');
    logger.debug('debug');
    logger.highlight('highlight');

    expect(log).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it('keeps warnings and errors visible in test mode', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    logger.warn('warn');
    logger.error('error');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('allows explicit test log diagnostics', () => {
    process.env[testLogsEnv] = '1';
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    logger.info('diagnostic');

    expect(log).toHaveBeenCalledTimes(1);
  });
});
