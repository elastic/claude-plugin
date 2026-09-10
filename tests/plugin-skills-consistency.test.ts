import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from '@jest/globals';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PLUGIN_JSON_PATH = resolve(ROOT, '.claude-plugin/plugin.json');

interface PluginJson {
  skills: string[];
}

function readPluginJson(): PluginJson {
  return JSON.parse(readFileSync(PLUGIN_JSON_PATH, 'utf-8'));
}

function findSkillDirsOnDisk(): string[] {
  const output = execSync('find skills -name SKILL.md', {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((skillMdPath) => './' + skillMdPath.replace('/SKILL.md', ''))
    .sort();
}

describe('plugin.json skills consistency', () => {
  const plugin = readPluginJson();
  const listedSkills = [...plugin.skills].sort();
  const diskSkills = findSkillDirsOnDisk();

  it('every plugin.json skill entry points to a real skills/ directory', () => {
    const missing = listedSkills.filter((skill) => {
      const skillMd = resolve(ROOT, skill, 'SKILL.md');
      return !existsSync(skillMd);
    });
    expect(missing).toEqual([]);
  });

  it('every skills/ directory with a SKILL.md is listed in plugin.json', () => {
    const unlisted = diskSkills.filter((dir) => !listedSkills.includes(dir));
    expect(unlisted).toEqual([]);
  });

  it('plugin.json skills array is sorted', () => {
    expect(plugin.skills).toEqual(listedSkills);
  });

  it('plugin.json skills array has no duplicates', () => {
    const unique = [...new Set(plugin.skills)];
    expect(plugin.skills).toEqual(unique);
  });

  it('skill paths use the ./skills/<domain>/<name> convention', () => {
    const malformed = plugin.skills.filter(
      (s) => !/^\.\/skills\/[a-z0-9-]+\/[a-z0-9-]+$/.test(s),
    );
    expect(malformed).toEqual([]);
  });
});
