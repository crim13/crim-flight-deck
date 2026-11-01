import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ZodType } from 'zod';
import type { Logger } from '../logger';

/**
 * Versioned JSON persistence. Invalid or unknown-version files are moved aside
 * (`<name>.bad-<timestamp>`) and replaced by defaults, never silently overwritten.
 * Writes are atomic (temp file + rename).
 */
export class JsonFile<T> {
  value: T;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    readonly path: string,
    private readonly schema: ZodType<T, any, any>,
    private readonly makeDefault: () => T,
    private readonly log: Logger,
  ) {
    this.value = this.load();
  }

  private load(): T {
    if (!existsSync(this.path)) {
      const d = this.makeDefault();
      this.writeNow(d);
      return d;
    }
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8'));
      const r = this.schema.safeParse(raw);
      if (r.success) return r.data;
      throw new Error(r.error.issues[0]?.message ?? 'schema mismatch');
    } catch (e) {
      const bad = `${this.path}.bad-${Date.now()}`;
      try { renameSync(this.path, bad); } catch { /* ignore */ }
      this.log.warn(`config ${this.path} unusable (${(e as Error).message}); moved to ${bad}, using defaults`);
      const d = this.makeDefault();
      this.writeNow(d);
      return d;
    }
  }

  private writeNow(v: T): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(v, null, 2) + '\n', 'utf8');
    renameSync(tmp, this.path);
  }

  set(v: T, debounceMs = 150): void {
    this.value = v;
    if (this.timer) clearTimeout(this.timer);
    if (debounceMs <= 0) return this.flush();
    this.timer = setTimeout(() => this.flush(), debounceMs);
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try { this.writeNow(this.value); } catch (e) { this.log.error(`could not write ${this.path}: ${(e as Error).message}`); }
  }
}
