/**
 * @module logger
 * @description Colored console logging utility for development
 * @since 2025-11-19
 * @version 1.0.0
 */

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

/**
 * Colored console logger singleton
 */
class Logger {
  /**
   * Success message (green)
   */
  success(message: string, ...args: any[]): void {
    console.log(green + message + reset, ...args);
  }

  /**
   * Error message (red)
   */
  error(message: string, ...args: any[]): void {
    console.error(red + message + reset, ...args);
  }

  /**
   * Warning message (yellow)
   */
  warn(message: string, ...args: any[]): void {
    console.warn(yellow + message + reset, ...args);
  }

  /**
   * Info message (blue)
   */
  info(message: string, ...args: any[]): void {
    console.log(blue + message + reset, ...args);
  }

  /**
   * Debug message (cyan)
   */
  debug(message: string, ...args: any[]): void {
    console.debug(cyan + message + reset, ...args);
  }

  /**
   * Highlight message (magenta)
   */
  highlight(message: string, ...args: any[]): void {
    console.log(magenta + message + reset, ...args);
  }
}

// Singleton instance
const logger = new Logger();

export default logger;
