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
 */
const DEFAULT_URL =
  'https://telemetry-staging.elastic.co/v3/send/elastic-claude-plugin';

async function pluginVersion($: EngineInterface): Promise<string> {
  const plugin_info = await $.fs.read(
    `${$.plugin.root}/.claude-plugin/plugin.json`,
  );
  const parsed: { version?: unknown } = JSON.parse(plugin_info);
  return typeof parsed.version === 'string' ? parsed.version : 'unknown';
}

const INSTALL_ID = 'install-id';
const INSTALL_REPORTED = 'install-reported';
const ACTIVE_REPORTED = 'active-reported';

type Props = Record<string, string>;

const isOn = (v: string | undefined) => {
  const value = v?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
};

/**
 * Checks if telemetry is disabled by any of the following environment variables
 */
async function optedOut($: EngineInterface): Promise<boolean> {
  return (
    isOn(await $.env.get('DO_NOT_TRACK')) ||
    isOn(await $.env.get('DISABLE_TELEMETRY')) ||
    isOn(await $.env.get('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'))
  );
}

/**
 * Nothing is written to the transcript unless ELASTIC_PLUGIN_TELEMETRY_DEBUG is set.
 */
async function debugLog($: EngineInterface, message: string): Promise<void> {
  if (isOn(await $.env.get('ELASTIC_PLUGIN_TELEMETRY_DEBUG'))) {
    $.ui.log(message);
  }
}

/** Empty disables sending; any other value overrides the endpoint. */
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

/**
 * Posts a telemetry event to the specified URL.
 */
async function post(
  $: EngineInterface,
  eventType: string,
  properties: Props,
): Promise<boolean> {
  try {
    if (await optedOut($)) return false;
    const url = await endpoint($);
    if (url === undefined) return false;

    const id = await installId($);
    const reported = await pluginVersion($);
    const body =
      JSON.stringify({
        timestamp: new Date(await $.clock.now()).toISOString(),
        event_type: eventType,
        properties: {
          ...properties,
          install_id: id,
          plugin_version: reported,
          session_id: await $.session.id(),
          model: await $.session.model(),
          cc_version: (await $.session.version()).version,
        },
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
      await debugLog($, `${eventType}: telemetry refused (${sent.status})`);
    }
    return sent.ok;
  } catch (err) {
    await debugLog($, `${eventType}: telemetry failed (${err})`);
    return false;
  }
}

/**
 * Posts a telemetry event for a skill invocation.
 */
async function postSkill($: EngineInterface, name: string): Promise<boolean> {
  const prefix = `${$.plugin.name}:`;
  const skill = name.startsWith(prefix) ? name.slice(prefix.length) : undefined;
  if (skill === undefined) return false;
  return post($, 'claude_plugin_skill_invoked', { name: skill });
}

/**
 * Registers the hooks for the plugin.
 */
export const register: Register = (on) => {
  // When a new session starts, post a telemetry event for the install.
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

  // When a skill is invoked, post a telemetry event for the skill invocation.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const [result] = await Promise.all([
      next(e),
      postSkill($, e.skill).catch(() => false),
    ]);
    return result;
  });

  // A typed /elastic:name never arrives as a Skill tool call, so report it here.
  on('command.run', async ($, e, next) => {
    const [result] = await Promise.all([
      next(e),
      postSkill($, e.command).catch(() => false),
    ]);
    return result;
  });
};
