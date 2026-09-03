#!/usr/bin/env node
/**
 * Mirrors this package into discord-html-transcript.
 *
 * discord-transcriber is the source of truth. Every edit is made here, then
 * pushed to the mirror by this script, which rewrites the package name
 * wherever it appears. The two packages ship identical code under identical
 * version numbers.
 *
 *   npm run sync           # sync, report what changed
 *   npm run sync:check     # report only, write nothing; exits 1 if out of sync
 *   npm run sync:verify    # sync, then typecheck + test + build the mirror
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_NAME = 'discord-transcriber';
const MIRROR_NAME = 'discord-html-transcript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mirror = process.env.MIRROR_PATH
  ? resolve(process.env.MIRROR_PATH)
  : resolve(root, '..', MIRROR_NAME);

const checkOnly = process.argv.includes('--check');
const verify = process.argv.includes('--verify');

/** Directories mirrored wholesale — files removed here are removed there. */
const DIRS = ['src', 'tests', 'examples', '.github'];

/** Individual files mirrored as-is (after the name rewrite). */
const FILES = [
  'README.md',
  'README.ar.md',
  'CHANGELOG.md',
  'LICENSE',
  '.gitignore',
  'tsconfig.json',
  'tsup.config.ts',
  'package-lock.json',
];

/** Never mirrored: this script is source-side only, and must not run in reverse. */
const EXCLUDE = new Set(['scripts']);

const added = [];
const changed = [];
const removed = [];

/**
 * Swaps the two names rather than replacing one with the other, so a file may
 * name both and still read correctly on each side. The README's "two names,
 * one package" notice depends on this: whichever package you are reading,
 * it names itself first and its twin second.
 */
function rewrite(buffer) {
  // A NUL byte means binary — pass it through untouched, and frees NUL as a
  // sentinel for the swap below.
  if (buffer.includes(0)) return buffer;
  const swapped = buffer
    .toString('utf8')
    .split(SOURCE_NAME)
    .join('\u0000')
    .split(MIRROR_NAME)
    .join(SOURCE_NAME)
    .split('\u0000')
    .join(MIRROR_NAME);
  return Buffer.from(swapped, 'utf8');
}

function put(relPath, contents) {
  const dest = join(mirror, relPath);
  if (existsSync(dest) && readFileSync(dest).equals(contents)) return;
  (existsSync(dest) ? changed : added).push(relPath);
  if (checkOnly) return;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, contents);
}

function drop(relPath) {
  removed.push(relPath);
  if (!checkOnly) rmSync(join(mirror, relPath), { force: true });
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

/**
 * package.json needs one structural edit beyond the name rewrite: the mirror
 * has no scripts/ directory, so no `sync`-family script may survive there.
 */
function syncPackageJson() {
  const pkg = JSON.parse(rewrite(readFileSync(join(root, 'package.json'))).toString('utf8'));
  for (const key of Object.keys(pkg.scripts)) {
    if (key === 'sync' || key.startsWith('sync:')) delete pkg.scripts[key];
  }

  const before = existsSync(join(mirror, 'package.json'))
    ? JSON.parse(readFileSync(join(mirror, 'package.json'), 'utf8'))
    : null;

  put('package.json', Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`, 'utf8'));

  const deps = (p) => JSON.stringify([p?.dependencies, p?.devDependencies, p?.peerDependencies]);
  return { version: pkg.version, depsChanged: before !== null && deps(before) !== deps(pkg) };
}

if (!existsSync(mirror)) {
  console.error(`mirror not found: ${mirror}`);
  console.error(`set MIRROR_PATH if it lives elsewhere`);
  process.exit(1);
}

for (const dir of DIRS) {
  if (EXCLUDE.has(dir)) continue;

  // A directory gone from the source empties out of the mirror too.
  const sourceFiles = existsSync(join(root, dir)) ? walk(join(root, dir)) : [];

  // Deletions run before copies: on this case-insensitive filesystem a
  // case-only rename must remove the old-cased mirror file first, or the
  // fresh copy would land in the old-cased file and then be deleted.
  if (existsSync(join(mirror, dir))) {
    const keep = new Set(sourceFiles);
    for (const rel of walk(join(mirror, dir))) {
      if (!keep.has(rel)) drop(`${dir}/${rel}`);
    }
  }

  for (const rel of sourceFiles) {
    put(`${dir}/${rel}`, rewrite(readFileSync(join(root, dir, rel))));
  }
}

for (const file of FILES) {
  if (existsSync(join(root, file))) put(file, rewrite(readFileSync(join(root, file))));
  else if (existsSync(join(mirror, file))) drop(file);
}

const { version, depsChanged } = syncPackageJson();

const total = added.length + changed.length + removed.length;
for (const [label, list] of [
  ['+', added],
  ['~', changed],
  ['-', removed],
]) {
  for (const file of list) console.log(`  ${label} ${file}`);
}

if (total === 0) {
  console.log(`mirror already in sync at ${version}`);
} else if (checkOnly) {
  console.log(`\n${total} file(s) out of sync — run without --check to apply`);
  process.exit(1);
} else {
  console.log(`\nsynced ${total} file(s) to ${mirror} at ${version}`);
  if (depsChanged) console.log(`dependencies changed — run "npm install" in the mirror`);
}

if (verify && !checkOnly) {
  for (const script of ['typecheck', 'test', 'build']) {
    console.log(`\n> mirror: npm run ${script}`);
    const run = spawnSync('npm', ['run', script], {
      cwd: mirror,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (run.status !== 0) process.exit(run.status ?? 1);
  }
}
