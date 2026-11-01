import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from './app';
import { silentLogger } from './logger';
import { UpdateChecker, compareVersions } from './update';
import { repoSlug } from './version';

const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v1.2.0',
  html_url: 'https://github.com/crim13/crim-flight-deck/releases/tag/v1.2.0',
  body: 'notes',
  published_at: '2026-01-01T00:00:00Z',
  assets: [{ name: 'CRIM-FlightDeck-v1.2.0-win-x64.zip' }, { name: 'SHA256SUMS.txt' }],
  ...over,
});
const stub = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const checker = (fetchFn: typeof fetch, current = '1.0.0', repo: string | null = 'crim13/crim-flight-deck', enabled = true) =>
  new UpdateChecker({ repo, current, log: silentLogger, enabled, fetchFn });

describe('versions', () => {
  it('compares semantic versions, a pre-release is older than its release', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.1.0-beta.1', '1.1.0')).toBe(-1);
    expect(compareVersions('1.1.0', '1.1.0-beta.1')).toBe(1);
    expect(compareVersions('garbage', '1.0.0')).toBe(0);
  });
  it('derives owner/name from the repository field', () => {
    expect(repoSlug('https://github.com/crim13/crim-flight-deck.git')).toBe('crim13/crim-flight-deck');
    expect(repoSlug('github:crim13/crim-flight-deck')).toBe('crim13/crim-flight-deck');
    expect(repoSlug('crim13/crim-flight-deck')).toBe('crim13/crim-flight-deck');
    expect(repoSlug('')).toBeNull();
  });
});

describe('update checker', () => {
  it('reports a newer release that has the installer zip', async () => {
    const f = stub(release());
    const info = await checker(f).check();
    expect(info).toMatchObject({ latest: '1.2.0', available: true, assetName: 'CRIM-FlightDeck-v1.2.0-win-x64.zip', error: null });
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe('https://api.github.com/repos/crim13/crim-flight-deck/releases/latest');
  });
  it('is quiet when up to date, or when the release has no zip yet', async () => {
    expect((await checker(stub(release())).check()).available).toBe(true);
    expect((await checker(stub(release()), '1.2.0').check()).available).toBe(false);
    expect((await checker(stub(release({ assets: [] }))).check()).available).toBe(false);
  });
  it('never throws: network errors, 404 and odd tags become an error message', async () => {
    expect((await checker(vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch).check()).error).toBe('offline');
    expect((await checker(stub({}, 404)).check()).error).toMatch(/no release/);
    expect((await checker(stub({}, 500)).check()).error).toMatch(/500/);
    expect((await checker(stub(release({ tag_name: '1.2.0<script>' }))).check()).error).toMatch(/unexpected release tag/);
    expect((await checker(stub(release()), '1.0.0', null).check()).error).toMatch(/no repository/);
  });
  it('does not accept a release page outside github.com', async () => {
    expect((await checker(stub(release({ html_url: 'https://evil.example/x' }))).check()).releaseUrl).toBeNull();
  });
  it('is disabled by config and does nothing then', () => {
    const f = stub(release());
    const c = checker(f, '1.0.0', 'crim13/crim-flight-deck', false);
    expect(c.enabled).toBe(false);
    c.start();
    c.stop();
    expect(f).not.toHaveBeenCalled();
  });
});

function call(port: number, path: string, method: string, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('update endpoints (admin page)', () => {
  let dir: string;
  let app: App;
  let port: number;
  const applied = vi.fn();
  const ok = { 'X-CRIM-Action': 'update' };

  const boot = async (mode: 'release' | 'dev', body: unknown = release()) => {
    const updates = checker(stub(body));
    await updates.check();
    app = createApp({
      dataDir: dir, overrides: { host: '127.0.0.1', port: 0, adapter: 'mock' }, log: silentLogger, webRoot: join(dir, 'no-web'),
      updates, installMode: mode, applyUpdate: applied,
    });
    ({ port } = await app.start());
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'crim-upd-'));
    applied.mockClear();
  });
  afterEach(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('shows the update state', async () => {
    await boot('release');
    const r = await call(port, '/api/update', 'GET');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ available: true, latest: '1.2.0', installMode: 'release', enabled: true });
  });

  it('applies only when asked from this PC, by this server\'s own page, with the action header', async () => {
    await boot('release');
    expect((await call(port, '/api/update/apply', 'POST')).status).toBe(403); // no header: e.g. a plain cross-site form post
    expect((await call(port, '/api/update/apply', 'POST', { ...ok, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(port, '/api/update/apply', 'POST', { ...ok, Origin: `http://127.0.0.1:${port}`, Host: `127.0.0.1:${port}` })).status).toBe(202);
    expect(applied).toHaveBeenCalledTimes(1);
  });

  it('refuses when nothing is newer, and in a development checkout', async () => {
    await boot('release', release({ tag_name: 'v1.0.0' }));
    expect((await call(port, '/api/update/apply', 'POST', ok)).status).toBe(409);
    await app.stop();
    await boot('dev');
    expect((await call(port, '/api/update/apply', 'POST', ok)).status).toBe(409);
    expect(applied).not.toHaveBeenCalled();
  });
});
