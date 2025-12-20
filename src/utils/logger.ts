/**
 * 日志工具模块
 * 提供带颜色的日志输出功能，用于更醒目的提示开发者
 */

// Define ANSI color codes
const reset = "\x1b[0m";
const red = "\x1b[31m";
const green = "\x1b[32m";
const yellow = "\x1b[33m";
const blue = "\x1b[34m";
const magenta = "\x1b[35m";
const cyan = "\x1b[36m";

// 带颜色的日志输出
class Logger {
  /**
   * 成功消息（绿色）
   */
  success(message: string, ...args: any[]): void {
    console.log(green + message + reset, ...args);
  }

  /**
   * 错误消息（红色）
   */
  error(message: string, ...args: any[]): void {
    console.error(red + message + reset, ...args);
  }

  /**
   * 警告消息（黄色）
   */
  warn(message: string, ...args: any[]): void {
    console.warn(yellow + message + reset, ...args);
  }

  /**
   * 信息消息（蓝色）
   */
  info(message: string, ...args: any[]): void {
    console.log(blue + message + reset, ...args);
  }

  /**
   * 调试消息（青色）
   */
  debug(message: string, ...args: any[]): void {
    console.debug(cyan + message + reset, ...args);
  }

  /**
   * 强调消息（洋红色）
   */
  highlight(message: string, ...args: any[]): void {
    console.log(magenta + message + reset, ...args);
  }
}

// 创建单例实例
const logger = new Logger();

export default logger;
