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

import type { EngineInterface, Register } from 'claude-code';

/**
 * Elastic's v3 telemetry ingest, staging channel `elastic-claude-plugin`.
 * The endpoint answers 400 `{"error": "bad request"}` to a POST that is
 * missing either X-Elastic-Cluster-ID or X-Elastic-Stack-Version, so both
 * ride on every event below.
 */
const DEFAULT_URL = 'https://telemetry-staging.elastic.co/v3/send/elastic-claude-plugin';

type Manifest = { version: string; skills: string[] };

/**
 * The manifest the release workflow bumps and the skills sync regenerates, so
 * the reported version and the set of this plugin's skills never drift from
 * the shipped ones; read once, since neither can change under a loaded plugin.
 */
let manifest: Manifest | undefined;

async function readManifest($: EngineInterface): Promise<Manifest> {
  if (manifest !== undefined) return manifest;
  try {
    const parsed: { version?: unknown; skills?: unknown } = JSON.parse(
      await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`),
    );
    manifest = {
      version: typeof parsed.version === 'string' ? parsed.version : '0.0.0',
      skills: Array.isArray(parsed.skills)
        ? parsed.skills.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    manifest = { version: '0.0.0', skills: [] };
  }
  return manifest;
}
async function pluginVersion($: EngineInterface): Promise<string> {
  return (await readManifest($)).version;
}

let skillNames: Map<string, string> | undefined;

/**
 * Every name a skill of this plugin may be expanded under, its directory's
 * and its frontmatter's, mapped to the frontmatter's so one skill reports
 * under one name; the two differ for some (`cloud/onboarding` is named
 * `cloud-onboarding`).
 */
async function ownSkills($: EngineInterface): Promise<Map<string, string>> {
  if (skillNames !== undefined) return skillNames;
  const names = new Map<string, string>();
  for (const path of (await readManifest($)).skills) {
    const dir = path.replace(/^\.\//, '').replace(/\/$/, '');
    const base = dir.slice(dir.lastIndexOf('/') + 1);
    let named = base;
    try {
      const skill = await $.fs.read(`${$.plugin.root}/${dir}/SKILL.md`);
      named = /^name:\s*["']?([^"'\s]+)/m.exec(skill)?.[1] ?? base;
    } catch {
      // The directory's name still stands for it.
    }
    names.set(base, named);
    names.set(named, named);
  }
  skillNames = names;
  return names;
}

const INSTALL_ID = 'install-id';
const INSTALL_REPORTED = 'install-reported';
const ACTIVE_REPORTED = 'active-reported';

type Props = Record<string, string>;

const isOn = (v: string | undefined) =>
  v !== undefined && /^(1|true|yes|on)$/i.test(v.trim());

async function optedOut($: EngineInterface): Promise<boolean> {
  return (
    isOn(await $.env.get('DO_NOT_TRACK')) ||
    isOn(await $.env.get('DISABLE_TELEMETRY')) ||
    isOn(await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'))
  );
}

/** Empty disables sending; any other value overrides the endpoint (tests). */
async function endpoint($: EngineInterface): Promise<string | undefined> {
  const override = await $.env.get('ELASTIC_PLUGIN_TELEMETRY_URL');
  if (override === undefined) return DEFAULT_URL;
  return override.trim() === '' ? undefined : override.trim();
}

/**
 * One id per install, kept in the plugin's own store, so events from the same
 * machine group without anything about the machine riding along.
 */
async function installId($: EngineInterface): Promise<string> {
  const held = await $.store.get(INSTALL_ID);
  if (typeof held === 'string' && held !== '') return held;
  const fresh = crypto.randomUUID();
  await $.store.set(INSTALL_ID, fresh);
  return fresh;
}

async function post(
  $: EngineInterface,
  eventType: string,
  properties: Props,
): Promise<boolean> {
  if (await optedOut($)) return false;
  const url = await endpoint($);
  if (url === undefined) return false;

  const id = await installId($);
  const reported = await pluginVersion($);
  const body =
    JSON.stringify({
      timestamp: new Date(await $.clock.now()).toISOString(),
      event_type: eventType,
      properties: { ...properties, install_id: id, plugin_version: reported },
      // Staging only for now, so nothing here should count as real usage.
      context: { isDev: true },
    }) + '\n';

  const sent = await $.http.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-ndjson',
      'X-Elastic-Cluster-ID': id,
      'X-Elastic-Stack-Version': reported,
    },
    body,
  });
  if (!sent.ok) {
    $.ui.log(`${eventType}: telemetry refused (${sent.status})`);
  }
  return sent.ok;
}

export const register: Register = (on) => {
  // An install is reported once, and a day's use once, both marked in the
  // store only after the POST lands so a failed report is retried next start.
  on('session.start', async ($, e, next) => {
    const started = await next(e);

    if ((await $.store.get(INSTALL_REPORTED)) !== true) {
      if (await post($, 'claude_plugin_install', {})) {
        await $.store.set(INSTALL_REPORTED, true);
      }
    }

    const today = new Date(await $.clock.now()).toISOString().slice(0, 10);
    if ((await $.store.get(ACTIVE_REPORTED)) !== today) {
      if (await post($, 'claude_plugin_active', {})) {
        await $.store.set(ACTIVE_REPORTED, today);
      }
    }

    return started;
  });

  // Not `skill.prompt`: the built-in sec-default module, in the prepend tier,
  // hands that event past the user tier with `next.to`, so a user plugin's
  // hook on it never runs. A skill starts either as the model's Skill tool
  // call or as a typed `/name` command, and neither of those is skipped.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const [result] = await Promise.all([next(e), reportSkill($, e.skill)]);
    return result;
  });

  on('command.run', async ($, e, next) => {
    const [result] = await Promise.all([next(e), reportSkill($, e.command)]);
    return result;
  });
};

/**
 * Reports `name` when it is one of this plugin's skills, bare or qualified
 * with the plugin's name. Run alongside the rest of the chain rather than
 * after it, so a skill waits for the slower of the two, not for both in turn.
 */
async function reportSkill($: EngineInterface, name: string): Promise<void> {
  const prefix = `${$.plugin.name}:`;
  const skill = (await ownSkills($)).get(
    name.startsWith(prefix) ? name.slice(prefix.length) : name,
  );
  if (skill === undefined) return;
  try {
    await post($, 'claude_plugin_skill_invoked', {
      skill_name: skill,
      plugin_name: $.plugin.name,
      session_id: await $.session.id(),
    });
  } catch (err) {
    $.ui.log(`claude_plugin_skill_invoked: telemetry failed (${err})`);
  }
}
