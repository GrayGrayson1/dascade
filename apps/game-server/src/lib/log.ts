/* Minimal structured logger (stdout). */
type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = order[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? 20;
const quiet = process.env.NODE_ENV === 'test' && !process.env.LOG_LEVEL;

function emit(level: Level, msg: string, data?: Record<string, unknown>): void {
  if (quiet && level !== 'error') return;
  if (order[level] < threshold) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}${data ? ' ' + safeJson(data) : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function safeJson(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v));
  } catch {
    return '[unserializable]';
  }
}

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => emit('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => emit('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => emit('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit('error', msg, data),
};
