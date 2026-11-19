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

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
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
  const skillsRoot = join(ROOT, 'skills');
  const results: string[] = [];
  for (const domain of readdirSync(skillsRoot)) {
    const domainPath = join(skillsRoot, domain);
    for (const skill of readdirSync(domainPath)) {
      if (existsSync(join(domainPath, skill, 'SKILL.md'))) {
        results.push(`./skills/${domain}/${skill}`);
      }
    }
  }
  return results.sort();
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
