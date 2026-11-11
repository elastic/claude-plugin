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
 * Elastic's v3 telemetry ingest, staging channel `elastic-ai-ecosystem`. The
 * channel is shared by every AI harness integration, so events say which one
 * sent them in `vendor`.
 */
const DEFAULT_URL =
  'https://telemetry-staging.elastic.co/v3/send/elastic-ai-ecosystem';

const VENDOR = 'claude';

const versions = new Map<string, Promise<string>>();

function pluginVersion($: EngineInterface): Promise<string> {
  const path = `${$.plugin.root}/.claude-plugin/plugin.json`;
  let held = versions.get(path);
  if (held === undefined) {
    held = $.fs.read(path).then((info) => {
      const parsed: { version?: unknown } = JSON.parse(info);
      return typeof parsed.version === 'string' ? parsed.version : 'unknown';
    });
    held.catch(() => versions.delete(path));
    versions.set(path, held);
  }
  return held;
}

const INSTALL_ID = 'install-id';
const INSTALL_REPORTED = 'install-reported';

type Props = Record<string, string | number | boolean | null>;

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
let cachedInstallId: string | undefined;

async function installId($: EngineInterface): Promise<string> {
  if (cachedInstallId !== undefined) return cachedInstallId;
  const held = await $.store.get(INSTALL_ID);
  if (typeof held === 'string' && held !== '') {
    cachedInstallId = held;
    return held;
  }
  const fresh = crypto.randomUUID();
  await $.store.set(INSTALL_ID, fresh);
  cachedInstallId = fresh;
  return fresh;
}

/**
 * The live context window, as the status line reads it. Asked without a
 * breakdown, so the call costs nothing. A session that has not answered yet
 * carries no token count, and a reading that cannot be taken rides along as
 * null rather than costing the event.
 */
async function contextUsage($: EngineInterface): Promise<Props> {
  try {
    const { context } = await $.session.usage();
    return {
      context_tokens: context.tokens ?? null,
      context_window: context.window,
      context_percent: context.percent ?? null,
    };
  } catch {
    return {
      context_tokens: null,
      context_window: null,
      context_percent: null,
    };
  }
}

/** Per-session properties captured at `session.start`, merged into every event. */
const sessionProps = new Map<string, Props>();

type Cluster = { id: string; stackVersion: string };
const UNKNOWN_CLUSTER: Cluster = { id: 'unknown', stackVersion: 'unknown' };

/**
 * Asks the Elastic CLI which cluster it is pointed at. The CLI is how the
 * plugin reaches Elasticsearch, so when it is configured this names the
 * cluster and the stack version. Any failure (no CLI, not configured, not
 * reachable, not JSON) reads as unknown and never costs the event.
 */
async function lookupCluster($: EngineInterface): Promise<Cluster> {
  try {
    const { exitCode, stdout } = await $.process.run(
      ['elastic', 'es', 'info'],
      { timeoutMs: 5000 },
    );
    if (exitCode !== 0) return UNKNOWN_CLUSTER;
    const info: { cluster_uuid?: unknown; version?: { number?: unknown } } =
      JSON.parse(stdout);
    return {
      id:
        typeof info.cluster_uuid === 'string' && info.cluster_uuid !== ''
          ? info.cluster_uuid
          : UNKNOWN_CLUSTER.id,
      stackVersion:
        typeof info.version?.number === 'string' && info.version.number !== ''
          ? info.version.number
          : UNKNOWN_CLUSTER.stackVersion,
    };
  } catch {
    return UNKNOWN_CLUSTER;
  }
}

let cluster: Promise<Cluster> | undefined;
const clusterInfo = ($: EngineInterface): Promise<Cluster> =>
  (cluster ??= lookupCluster($));

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
    const target = await clusterInfo($);
    const sessionId = await $.session.id();
    const body =
      JSON.stringify({
        timestamp: new Date(await $.clock.now()).toISOString(),
        vendor: VENDOR,
        event_type: eventType,
        properties: {
          ...sessionProps.get(sessionId),
          ...properties,
          install_id: id,
          plugin_version: reported,
          session_id: sessionId,
          model: await $.session.model(),
          cc_version: (await $.session.version()).version,
          ...(await contextUsage($)),
        },
        context: { isDev: true },
      }) + '\n';

    const sent = await $.http.fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-Elastic-Cluster-ID': target.id,
        'X-Elastic-Stack-Version': target.stackVersion,
      },
      body,
    });
    if (!sent.ok) {
      $.ui.log(`${eventType}: telemetry refused (${sent.status})`, {
        to: 'debug',
      });
    }
    return sent.ok;
  } catch (err) {
    $.ui.log(`${eventType}: telemetry failed (${err})`, { to: 'debug' });
    return false;
  }
}

/**
 * Posts a telemetry event for a skill invocation.
 */
async function postSkill(
  $: EngineInterface,
  name: string,
  durationMs: number,
  isError: boolean,
): Promise<boolean> {
  const prefix = `${$.plugin.name}:`;
  const skill = name.startsWith(prefix) ? name.slice(prefix.length) : undefined;
  if (skill === undefined) return false;
  return post($, 'claude_plugin_skill_invoked', {
    plugin_name: $.plugin.name,
    skill_name: skill,
    duration_ms: durationMs,
    is_error: isError,
  });
}

/**
 * Runs the rest of the chain and reports the skill with how long it took and
 * whether it failed. A throw counts as a failure and is passed on untouched,
 * so a telemetry problem never changes what the caller sees.
 */
async function reportSkill<T>(
  $: EngineInterface,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const start = await $.clock.now();
  const report = async (isError: boolean) => {
    const durationMs = (await $.clock.now()) - start;
    await postSkill($, name, durationMs, isError).catch(() => false);
  };
  try {
    const result = await run();
    const failed =
      typeof result === 'object' &&
      result !== null &&
      'isError' in result &&
      result.isError === true;
    await report(failed);
    return result;
  } catch (err) {
    await report(true);
    throw err;
  }
}

/**
 * Registers the hooks for the plugin.
 */
export const register: Register = (on) => {
  // When a new session starts, post a telemetry event for the install.
  on('session.start', async ($, e, next) => {
    const started = await next(e);
    sessionProps.set(await $.session.id(), {
      surface: e.surface,
      is_interactive: e.isInteractive,
    });

    if ((await $.store.get(INSTALL_REPORTED)) !== true) {
      if (await post($, 'claude_plugin_install', {})) {
        await $.store.set(INSTALL_REPORTED, true);
      }
    }

    await post($, 'claude_plugin_active', {});

    return started;
  });

  // When a skill is invoked, post a telemetry event for the skill invocation.
  on('tool.call', { tool: 'Skill' }, ($, e, next) =>
    reportSkill($, e.skill, () => next(e)),
  );

  // A typed /elastic:name never arrives as a Skill tool call, so report it here.
  // A command carries no error of its own, so only a throw counts as one.
  on('command.run', ($, e, next) => reportSkill($, e.command, () => next(e)));
};
