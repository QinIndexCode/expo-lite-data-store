const supportsColor =
  typeof process !== 'undefined' &&
  process.env.NODE_ENV !== 'test' &&
  typeof process.stdout !== 'undefined' &&
  process.stdout.isTTY === true;

const reset = supportsColor ? '\x1b[0m' : '';
const red = supportsColor ? '\x1b[31m' : '';
const green = supportsColor ? '\x1b[32m' : '';
const yellow = supportsColor ? '\x1b[33m' : '';
const blue = supportsColor ? '\x1b[34m' : '';
const magenta = supportsColor ? '\x1b[35m' : '';
const cyan = supportsColor ? '\x1b[36m' : '';

type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

const logLevelPriority: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const isLogLevel = (value: string | undefined): value is LogLevel =>
  value === 'silent' || value === 'error' || value === 'warn' || value === 'info' || value === 'debug';

const getLogLevel = (): LogLevel => {
  if (typeof process === 'undefined') {
    return 'warn';
  }

  if (process.env.NODE_ENV === 'test') {
    return process.env.EXPO_LITE_DATA_STORE_TEST_LOGS === '1' ? 'debug' : 'silent';
  }

  const configuredLevel = process.env.EXPO_LITE_DATA_STORE_LOG_LEVEL?.toLowerCase();
  return isLogLevel(configuredLevel) ? configuredLevel : 'warn';
};

const shouldLogMessage = (level: Exclude<LogLevel, 'silent'>): boolean =>
  logLevelPriority[getLogLevel()] >= logLevelPriority[level];

class Logger {
  success(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage('info')) {
      return;
    }
    console.log(green + message + reset, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage('error')) {
      return;
    }
    console.error(red + message + reset, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage('warn')) {
      return;
    }
    console.warn(yellow + message + reset, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage('info')) {
      return;
    }
    console.log(blue + message + reset, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage('debug')) {
      return;
    }
    console.debug(cyan + message + reset, ...args);
  }

  highlight(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage('info')) {
      return;
    }
    console.log(magenta + message + reset, ...args);
  }
}

const logger = new Logger();

export default logger;
