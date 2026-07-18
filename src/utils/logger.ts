// Detect ANSI color code support
const supportsColor =
  typeof process !== 'undefined' &&
  process.env.NODE_ENV !== 'test' &&
  typeof process.stdout !== 'undefined' &&
  process.stdout.isTTY === true;

// ANSI color codes (used only when supported)
const reset = supportsColor ? '\x1b[0m' : '';
const red = supportsColor ? '\x1b[31m' : '';
const green = supportsColor ? '\x1b[32m' : '';
const yellow = supportsColor ? '\x1b[33m' : '';
const blue = supportsColor ? '\x1b[34m' : '';
const magenta = supportsColor ? '\x1b[35m' : '';
const cyan = supportsColor ? '\x1b[36m' : '';

const shouldLogMessage = (): boolean =>
  typeof process === 'undefined' ||
  process.env.NODE_ENV !== 'test' ||
  process.env.EXPO_LITE_DATA_STORE_TEST_LOGS === '1';

/**
 * Colored console logger singleton
 */
class Logger {
  /**
   * Success message (green)
   */
  success(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage()) {
      return;
    }
    console.log(green + message + reset, ...args);
  }

  /**
   * Error message (red)
   */
  error(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage()) {
      return;
    }
    console.error(red + message + reset, ...args);
  }

  /**
   * Warning message (yellow)
   */
  warn(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage()) {
      return;
    }
    console.warn(yellow + message + reset, ...args);
  }

  /**
   * Info message (blue)
   */
  info(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage()) {
      return;
    }
    console.log(blue + message + reset, ...args);
  }

  /**
   * Debug message (cyan)
   */
  debug(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage()) {
      return;
    }
    console.debug(cyan + message + reset, ...args);
  }

  /**
   * Highlight message (magenta)
   */
  highlight(message: string, ...args: unknown[]): void {
    if (!shouldLogMessage()) {
      return;
    }
    console.log(magenta + message + reset, ...args);
  }
}

// Singleton instance
const logger = new Logger();

export default logger;
