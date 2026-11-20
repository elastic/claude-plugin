/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from '@jest/globals';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '..', 'scripts', 'cut-release-branch.sh');

const STRIP_SUBJECT = 'chore: strip dev package manifests for stable';
const SEED_CHANGELOG =
  '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- first (#1)\n';

const repos: string[] = [];

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(
  repo: string,
  command: string,
  args: string[],
  env: Record<string, string> = {},
): RunResult {
  const result = spawnSync(command, args, {
    cwd: repo,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

/** Runs git and fails the test if git does. */
function git(repo: string, ...args: string[]): string {
  const result = run(repo, 'git', args);
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function write(repo: string, path: string, content: string): void {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function read(repo: string, path: string): string {
  return readFileSync(join(repo, path), 'utf-8');
}

/**
 * A repository as it stands after a v0.1.0 release: `main` and `stable` at the
 * same `release: v0.1.0` commit, with the dev package manifests on both.
 */
function makeRepo(changelog: string = SEED_CHANGELOG): string {
  const repo = mkdtempSync(join(tmpdir(), 'cut-release-'));
  repos.push(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'test');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  // Keep developers' global git hooks out of the test.
  git(repo, 'config', 'core.hooksPath', '/dev/null');
  write(
    repo,
    '.claude-plugin/plugin.json',
    '{"name":"elastic","version":"0.1.0"}\n',
  );
  write(repo, 'CHANGELOG.md', changelog);
  write(repo, 'package.json', '{"private":true}\n');
  write(repo, 'package-lock.json', '{"lockfileVersion":3}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'release: v0.1.0');
  git(repo, 'branch', 'stable');
  return repo;
}

function cut(repo: string, version: string): RunResult {
  return run(repo, 'bash', [SCRIPT, version], {
    BASE_REF: 'main',
    STABLE_REF: 'stable',
    RELEASE_DATE: '2026-01-01',
  });
}

function releaseBranch(version: string): string {
  return `automation/release-v${version}`;
}

/**
 * The release PR merging into `stable`. GitHub puts the PR title in the body
 * of the merge commit, so the merge carries a `release: vX` line of its own.
 */
function mergeRelease(repo: string, version: string): void {
  git(repo, 'checkout', '-q', 'stable');
  git(
    repo,
    'merge',
    '-q',
    '--no-ff',
    '-m',
    `Merge pull request #1 from elastic/${releaseBranch(version)}`,
    '-m',
    `release: v${version}`,
    releaseBranch(version),
  );
}

function releaseCommit(repo: string, ref: string, version: string): string {
  return git(
    repo,
    'log',
    ref,
    '--format=%H',
    '-1',
    '--no-merges',
    `--grep=^release: v${version.replaceAll('.', '\\.')}$`,
  );
}

/** The backport PR bringing the release commit to `main`. */
function backport(
  repo: string,
  version: string,
  how: 'merge' | 'squash',
): void {
  const commit = releaseCommit(repo, 'stable', version);
  git(repo, 'checkout', '-q', 'main');
  if (how === 'merge') {
    git(repo, 'merge', '-q', '--no-ff', '--no-edit', commit);
  } else {
    // What GitHub's "Squash and merge" does: same changes, new commit.
    git(repo, 'merge', '-q', '--squash', commit);
    git(repo, 'commit', '-q', '-m', `chore: backport release v${version}`);
  }
}

/** What lands on `main` between releases: a lockfile bump and a new entry. */
function developOnMain(repo: string): void {
  git(repo, 'checkout', '-q', 'main');
  write(repo, 'package-lock.json', '{"lockfileVersion":3,"packages":{}}\n');
  write(
    repo,
    'CHANGELOG.md',
    read(repo, 'CHANGELOG.md').replace(
      '## [Unreleased]\n',
      '## [Unreleased]\n\n### Added\n\n- second (#2)\n',
    ),
  );
  git(repo, 'commit', '-q', '-am', 'chore(deps): lock file maintenance');
}

function branchExists(repo: string, branch: string): boolean {
  return (
    run(repo, 'git', ['rev-parse', '--verify', '--quiet', branch]).status === 0
  );
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    rmSync(repo, { recursive: true, force: true });
  }
});

describe('cut-release-branch.sh', () => {
  it('strips both manifests from the release branch and keeps them on main', () => {
    const repo = makeRepo();

    const result = cut(repo, '0.2.0');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(
      releaseBranch('0.2.0'),
    );
    expect(existsSync(join(repo, 'package.json'))).toBe(false);
    expect(existsSync(join(repo, 'package-lock.json'))).toBe(false);
    expect(git(repo, 'show', 'main:package.json')).toBe('{"private":true}');
    expect(JSON.parse(read(repo, '.claude-plugin/plugin.json')).version).toBe(
      '0.2.0',
    );
    expect(read(repo, 'CHANGELOG.md')).toContain(
      '## [Unreleased]\n\n## [0.2.0] - 2026-01-01',
    );
  });

  it('the release commit touches only plugin.json and CHANGELOG.md', () => {
    const repo = makeRepo();

    cut(repo, '0.2.0');

    // `stable` is still an ancestor of `main` here, so merging it adds no commit.
    expect(git(repo, 'log', '--format=%s', 'main..HEAD').split('\n')).toEqual([
      STRIP_SUBJECT,
      'release: v0.2.0',
    ]);
    const commit = releaseCommit(repo, 'HEAD', '0.2.0');
    expect(
      git(repo, 'show', '--name-only', '--format=', commit).split('\n').sort(),
    ).toEqual(['.claude-plugin/plugin.json', 'CHANGELOG.md']);
  });

  it('a second release merges cleanly after the lockfile changed on main', () => {
    const repo = makeRepo();
    cut(repo, '0.2.0');
    mergeRelease(repo, '0.2.0');
    backport(repo, '0.2.0', 'merge');
    developOnMain(repo);

    const result = cut(repo, '0.3.0');

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(git(repo, 'ls-files', '-u')).toBe('');
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(repo, 'package.json'))).toBe(false);
    expect(existsSync(join(repo, 'package-lock.json'))).toBe(false);
    expect(
      run(repo, 'git', ['merge-base', '--is-ancestor', 'stable', 'HEAD'])
        .status,
    ).toBe(0);
    expect(JSON.parse(read(repo, '.claude-plugin/plugin.json')).version).toBe(
      '0.3.0',
    );
  });

  it('refuses to cut when the previous release commit is not on main', () => {
    const repo = makeRepo();
    cut(repo, '0.2.0');
    mergeRelease(repo, '0.2.0');
    backport(repo, '0.2.0', 'squash');
    developOnMain(repo);

    const result = cut(repo, '0.3.0');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('merge commit');
    expect(result.stderr).toContain('v0.2.0');
    expect(branchExists(repo, releaseBranch('0.3.0'))).toBe(false);
  });

  it('refuses to overwrite an existing release branch', () => {
    const repo = makeRepo();
    cut(repo, '0.2.0');
    const before = git(repo, 'rev-parse', releaseBranch('0.2.0'));

    const result = cut(repo, '0.2.0');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('already exists');
    expect(git(repo, 'rev-parse', releaseBranch('0.2.0'))).toBe(before);
  });

  it('leaves the changelog alone when it has no Unreleased section', () => {
    const repo = makeRepo('# Changelog\n');

    const result = cut(repo, '0.2.0');

    expect(result.status).toBe(0);
    expect(read(repo, 'CHANGELOG.md')).toBe('# Changelog\n');
  });
});
