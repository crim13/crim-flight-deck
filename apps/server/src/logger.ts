import type { LogLevel } from '@crim/shared';

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  readonly level: LogLevel;
  error(msg: string, ...a: unknown[]): void;
  warn(msg: string, ...a: unknown[]): void;
  info(msg: string, ...a: unknown[]): void;
  debug(msg: string, ...a: unknown[]): void;
  child(scope: string): Logger;
  setLevel(l: LogLevel): void;
}

export function createLogger(level: LogLevel = 'info', scope = '', sink: (line: string) => void = (l) => console.log(l)): Logger {
  const state = { level };
  const make = (sc: string): Logger => {
    const emit = (lvl: LogLevel, msg: string, a: unknown[]) => {
      if (ORDER[lvl] > ORDER[state.level]) return;
      const t = new Date().toISOString().slice(11, 23);
      const extra = a.length
        ? ' ' + a.map((x) => (typeof x === 'string' ? x : x instanceof Error ? x.message : JSON.stringify(x))).join(' ')
        : '';
      sink(`${t} ${lvl.toUpperCase().padEnd(5)} ${sc ? `[${sc}] ` : ''}${msg}${extra}`);
    };
    return {
      get level() { return state.level; },
      error: (m, ...a) => emit('error', m, a),
      warn: (m, ...a) => emit('warn', m, a),
      info: (m, ...a) => emit('info', m, a),
      debug: (m, ...a) => emit('debug', m, a),
      child: (s) => make(sc ? `${sc}:${s}` : s),
      setLevel: (l) => { state.level = l; },
    };
  };
  return make(scope);
}

export const silentLogger: Logger = createLogger('error', '', () => {});
