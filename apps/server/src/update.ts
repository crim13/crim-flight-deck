import type { Logger } from './logger';

export interface UpdateInfo {
  current: string;
  /** latest published release (null until a check succeeded) */
  latest: string | null;
  available: boolean;
  releaseUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
  /** the zip the updater would download */
  assetName: string | null;
  checkedAt: number | null;
  error: string | null;
}

/** Compares "1.2.3" style versions (a leading "v" and a "-pre" suffix are understood; a pre-release is older than its release). */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
    if (!m) return null;
    return { n: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i]! < y.n[i]! ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export interface UpdateCheckerOptions {
  repo: string | null;
  current: string;
  log: Logger;
  enabled: boolean;
  /** default https://api.github.com */
  apiBase?: string;
  intervalMs?: number;
  firstCheckDelayMs?: number;
  fetchFn?: typeof fetch;
}

const ASSET = /^CRIM-FlightDeck-.*-win-x64\.zip$/i;

/**
 * Looks at the latest GitHub release now and then. Read only: it never downloads or installs anything and sends
 * nothing but a plain HTTPS GET (GitHub sees the PC's IP address like for any web request). Disabled with
 * `checkForUpdates: false` in data\server.json or CRIM_NO_UPDATE_CHECK=1.
 */
export class UpdateChecker {
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private inflight: Promise<UpdateInfo> | null = null;
  info: UpdateInfo;

  constructor(private readonly o: UpdateCheckerOptions) {
    this.info = { current: o.current, latest: null, available: false, releaseUrl: null, notes: null, publishedAt: null, assetName: null, checkedAt: null, error: null };
  }

  get enabled(): boolean {
    return this.o.enabled && !!this.o.repo;
  }

  start(): void {
    if (!this.enabled) return;
    this.first = setTimeout(() => void this.check(), this.o.firstCheckDelayMs ?? 30_000);
    this.first.unref();
    this.timer = setInterval(() => void this.check(), this.o.intervalMs ?? 12 * 3600_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
    this.first = this.timer = null;
  }

  /** Never throws: failures are reported in `info.error`. */
  check(): Promise<UpdateInfo> {
    if (!this.o.repo) {
      this.info = { ...this.info, error: 'no repository configured' };
      return Promise.resolve(this.info);
    }
    this.inflight ??= this.run(this.o.repo).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async run(repo: string): Promise<UpdateInfo> {
    const doFetch = this.o.fetchFn ?? fetch;
    try {
      const res = await doFetch(`${this.o.apiBase ?? 'https://api.github.com'}/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'crim-flight-deck-update-check' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 404) throw new Error('no release published yet');
      if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
      const rel = (await res.json()) as { tag_name?: string; html_url?: string; body?: string; published_at?: string; draft?: boolean; prerelease?: boolean; assets?: { name?: string }[] };
      const latest = String(rel.tag_name ?? '').replace(/^v/, '');
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(latest)) throw new Error(`unexpected release tag "${rel.tag_name}"`);
      const asset = (rel.assets ?? []).find((a) => a.name && ASSET.test(a.name));
      this.info = {
        current: this.o.current,
        latest,
        available: compareVersions(latest, this.o.current) > 0 && !!asset,
        releaseUrl: typeof rel.html_url === 'string' && rel.html_url.startsWith('https://github.com/') ? rel.html_url : null,
        notes: typeof rel.body === 'string' ? rel.body.slice(0, 2000) : null,
        publishedAt: rel.published_at ?? null,
        assetName: asset?.name ?? null,
        checkedAt: Date.now(),
        error: null,
      };
      if (this.info.available) this.o.log.info(`update available: v${latest} (installed v${this.o.current}) - see the PC admin page`);
    } catch (e) {
      this.info = { ...this.info, checkedAt: Date.now(), error: e instanceof Error ? e.message : String(e) };
      this.o.log.debug(`update check failed: ${this.info.error}`);
    }
    return this.info;
  }
}
