import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT_DIR } from './paths';

// Replaced by esbuild (apps/server/build.mjs) with the values of the root package.json.
declare const __CRIM_VERSION__: string | undefined;
declare const __CRIM_REPO__: string | undefined;

function readRootPackage(): { version?: string; repository?: string | { url?: string } } {
  try {
    return JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** "https://github.com/owner/name.git" | "github:owner/name" | "owner/name" -> "owner/name" */
export function repoSlug(input: string | undefined | null): string | null {
  if (!input) return null;
  const m = /(?:github\.com[/:]|^github:|^)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(input.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

const pkg = typeof __CRIM_VERSION__ === 'string' ? null : readRootPackage();

export const SERVER_VERSION: string = typeof __CRIM_VERSION__ === 'string' ? __CRIM_VERSION__ : pkg?.version ?? '0.0.0';

/** GitHub repository the update check reads releases from (null = no update checks possible). */
export const UPDATE_REPO: string | null = repoSlug(
  typeof __CRIM_REPO__ === 'string' ? __CRIM_REPO__ : typeof pkg?.repository === 'string' ? pkg.repository : pkg?.repository?.url,
);

/** A release install has a version.json next to the scripts (written by scripts\package-release.ps1); a git checkout does not. */
export function installMode(root = ROOT_DIR): 'release' | 'dev' {
  try {
    readFileSync(join(root, 'version.json'), 'utf8');
    return 'release';
  } catch {
    return 'dev';
  }
}
