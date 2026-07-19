import logger from '../../utils/logger';

describe('logger test output hygiene', () => {
  const testLogsEnv = 'EXPO_LITE_DATA_STORE_TEST_LOGS';
  const logLevelEnv = 'EXPO_LITE_DATA_STORE_LOG_LEVEL';
  const nodeEnv: string = 'NODE_ENV';
  const originalTestLogs = process.env[testLogsEnv];
  const originalLogLevel = process.env[logLevelEnv];
  const originalNodeEnv = process.env[nodeEnv];

  afterEach(() => {
    if (originalTestLogs === undefined) {
      delete process.env[testLogsEnv];
    } else {
      process.env[testLogsEnv] = originalTestLogs;
    }
    if (originalLogLevel === undefined) {
      delete process.env[logLevelEnv];
    } else {
      process.env[logLevelEnv] = originalLogLevel;
    }
    if (originalNodeEnv === undefined) {
      delete process.env[nodeEnv];
    } else {
      process.env[nodeEnv] = originalNodeEnv;
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

  it('defaults production logging to warnings and errors', () => {
    process.env[nodeEnv] = 'production';
    delete process.env[logLevelEnv];
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    logger.info('info');
    logger.debug('debug');
    logger.warn('warn');
    logger.error('error');

    expect(log).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
