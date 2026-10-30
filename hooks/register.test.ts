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

import type { On } from 'claude-code';
import { describe, expect, mock, test } from 'claude-code/testing';

const PLUGIN_VERSION = '9.9.9';
const SESSION_ID = 'session-abc';
const MODEL = 'claude-opus-5';
const CC_VERSION = '2.1.308';

/** 2026-03-04T05:06:07Z, so the UTC day is unambiguous. */
const NOON = Date.UTC(2026, 2, 4, 5, 6, 7);
const DAY = 24 * 60 * 60 * 1000;

type Event = {
  timestamp: string;
  event_type: string;
  properties: Record<string, string>;
  context: { isDev: boolean };
};

/** A plain interactive session starting at the terminal. */
const STARTED = {
  cwd: '/work',
  surface: 'terminal' as const,
  isInteractive: true,
};

/** The envelope the engine stamps on a typed slash command. */
const TYPED = {
  args: '',
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 },
};

type Harness = {
  /** Every event posted, in order, already parsed out of the ndjson body. */
  events: () => Event[];
  urls: () => string[];
  headers: () => Record<string, string>[];
  /** Lines written to the transcript; telemetry should never add one. */
  transcript: () => string[];
  debug: () => string[];
};

type Options = {
  env?: Record<string, string>;
  store?: Record<string, unknown>;
  now?: number;
  /** What the collector answers; 200 unless given. */
  status?: number;
  /** When set, `$.http.fetch` rejects instead of answering. */
  offline?: boolean;
  /** The raw plugin.json the hook reads; a well-formed one unless given. */
  pluginJson?: string;
};

/**
 * Stands the world up beneath the plugin: a clock and store in memory, a
 * collector that records what it was sent, and fixed session facts.
 */
function harness(on: On, options: Options = {}): Harness {
  const events: Event[] = [];
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const transcript: string[] = [];
  const debug: string[] = [];

  mock.clock(on, { now: options.now ?? NOON });
  mock.store(on, options.store ?? {});
  mock.env(on, options.env ?? {});

  on('fs.read', () => ({
    value: options.pluginJson ?? JSON.stringify({ version: PLUGIN_VERSION }),
  }));
  on('session.id', () => ({ value: SESSION_ID }));
  on('session.model', () => ({ value: MODEL }));
  on('session.version', () => ({ value: { version: CC_VERSION } }));

  on('ui.log', ($, e) => {
    (e.to === 'debug' ? debug : transcript).push(e.text);
    return { value: undefined };
  });

  on('http.fetch', ($, e) => {
    if (options.offline) throw new Error('network is down');
    urls.push(e.url);
    headers.push({ ...e.init?.headers });
    for (const line of String(e.init?.body ?? '').split('\n')) {
      if (line.trim() !== '') events.push(JSON.parse(line));
    }
    const status = options.status ?? 200;
    return {
      value: {
        status,
        ok: status >= 200 && status < 300,
        headers: {},
        text: '',
      },
    };
  });

  // The bottom of each chain the plugin hooks.
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('tool.call', () => ({ result: { text: 'ok' }, text: 'ok' }));
  on('command.run', () => ({ text: 'ok' }));

  return {
    events: () => events,
    urls: () => urls,
    headers: () => headers,
    transcript: () => transcript,
    debug: () => debug,
  };
}

describe('session.start', () => {
  test('reports the install once, then not again', async ($, on) => {
    const h = harness(on);

    await $.session.start(STARTED);
    expect(h.events().map((e) => e.event_type)).toEqual([
      'claude_plugin_install',
      'claude_plugin_active',
    ]);

    await $.session.start(STARTED);
    expect(h.events().map((e) => e.event_type)).toEqual([
      'claude_plugin_install',
      'claude_plugin_active',
    ]);
  });

  test('retries the install when the collector refuses it', async ($, on) => {
    const h = harness(on, { status: 500 });

    await $.session.start(STARTED);
    await $.session.start(STARTED);

    // Nothing is marked reported until a POST succeeds, so both events repeat.
    expect(h.events().map((e) => e.event_type)).toEqual([
      'claude_plugin_install',
      'claude_plugin_active',
      'claude_plugin_install',
      'claude_plugin_active',
    ]);
  });

  test('reports active once per UTC day', async ($, on) => {
    const h = harness(on, {
      store: { 'install-reported': true, 'active-reported': '2026-03-04' },
    });

    await $.session.start(STARTED);
    expect(h.events()).toEqual([]);
  });

  test('reports active again on the next UTC day', async ($, on) => {
    const h = harness(on, {
      now: NOON + DAY,
      store: { 'install-reported': true, 'active-reported': '2026-03-04' },
    });

    await $.session.start(STARTED);
    expect(h.events().map((e) => e.event_type)).toEqual([
      'claude_plugin_active',
    ]);
    expect(h.events()[0]?.properties.install_id).toEqual(expect.any(String));
  });

  test('carries the install id, plugin, session and engine versions', async ($, on) => {
    const h = harness(on);

    await $.session.start(STARTED);

    const [install] = h.events();
    expect(install?.properties).toMatchObject({
      plugin_version: PLUGIN_VERSION,
      session_id: SESSION_ID,
      model: MODEL,
      cc_version: CC_VERSION,
    });
    expect(install?.timestamp).toBe(new Date(NOON).toISOString());
  });

  test('reuses one install id across events and sessions', async ($, on) => {
    const h = harness(on);

    await $.session.start(STARTED);
    await $.session.start(STARTED);

    const ids = new Set(h.events().map((e) => e.properties.install_id));
    expect(ids.size).toBe(1);
  });
});

describe('opting out', () => {
  for (const name of [
    'DO_NOT_TRACK',
    'DISABLE_TELEMETRY',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  ]) {
    test(`${name} stops everything`, async ($, on) => {
      const h = harness(on, { env: { [name]: '1' } });

      await $.session.start(STARTED);
      await $.command.run({ command: 'elastic:esql', ...TYPED });

      expect(h.urls()).toEqual([]);
    });
  }

  test('reads the flags loosely', async ($, on) => {
    const h = harness(on, { env: { DO_NOT_TRACK: ' YES ' } });

    await $.session.start(STARTED);

    expect(h.urls()).toEqual([]);
  });

  test('a flag set to 0 is not opting out', async ($, on) => {
    const h = harness(on, { env: { DO_NOT_TRACK: '0' } });

    await $.session.start(STARTED);

    expect(h.urls().length).toBeGreaterThan(0);
  });

  test('an empty endpoint override stops everything', async ($, on) => {
    const h = harness(on, { env: { ELASTIC_PLUGIN_TELEMETRY_URL: '  ' } });

    await $.session.start(STARTED);

    expect(h.urls()).toEqual([]);
  });
});

describe('the endpoint', () => {
  test('defaults to the staging channel', async ($, on) => {
    const h = harness(on);

    await $.session.start(STARTED);

    expect(h.urls()[0]).toBe(
      'https://telemetry-staging.elastic.co/v3/send/elastic-claude-plugin',
    );
  });

  test('honours an override', async ($, on) => {
    const h = harness(on, {
      env: { ELASTIC_PLUGIN_TELEMETRY_URL: ' https://example.test/send ' },
    });

    await $.session.start(STARTED);

    expect(h.urls()[0]).toBe('https://example.test/send');
  });
});

describe('the envelope the indexer reads', () => {
  test('sends ndjson, an unknown cluster and the plugin version', async ($, on) => {
    const h = harness(on);

    await $.session.start(STARTED);

    expect(h.headers()[0]).toEqual({
      'Content-Type': 'application/x-ndjson',
      // Becomes `cluster-uuid` in the envelope; the events come from a laptop.
      'X-Elastic-Cluster-ID': 'unknown',
      'X-Elastic-Stack-Version': PLUGIN_VERSION,
    });
  });

  test('marks every event as non-production', async ($, on) => {
    const h = harness(on);

    await $.session.start(STARTED);

    // The one context key the indexer maps; it has to flip for prod.
    expect(h.events().map((e) => e.context)).toEqual([
      { isDev: true },
      { isDev: true },
    ]);
  });

  test('falls back to an unknown plugin version', async ($, on) => {
    const h = harness(on, { pluginJson: '{}' });

    await $.session.start(STARTED);

    expect(h.events()[0]?.properties.plugin_version).toBe('unknown');
  });
});

describe('skills and commands', () => {
  /** A fresh store that has already reported its install and today. */
  const settled = () => ({
    'install-reported': true,
    'active-reported': '2026-03-04',
  });

  test('reports a Skill call, with the prefix stripped', async ($, on) => {
    const h = harness(on, { store: settled() });

    await $.tool.call({ tool: 'Skill', skill: 'elastic:elasticsearch-esql' });

    expect(h.events()).toMatchObject([
      {
        event_type: 'claude_plugin_skill_invoked',
        properties: {
          plugin_name: 'elastic',
          skill_name: 'elasticsearch-esql',
        },
      },
    ]);
  });

  test('ignores a Skill call from another plugin', async ($, on) => {
    const h = harness(on, { store: settled() });

    await $.tool.call({ tool: 'Skill', skill: 'other:thing' });

    expect(h.urls()).toEqual([]);
  });

  test('reports a typed slash command', async ($, on) => {
    const h = harness(on, { store: settled() });

    await $.command.run({ command: 'elastic:onboarding', ...TYPED });

    expect(h.events()).toMatchObject([
      {
        event_type: 'claude_plugin_skill_invoked',
        properties: { plugin_name: 'elastic', skill_name: 'onboarding' },
      },
    ]);
  });

  test('ignores an unrelated slash command', async ($, on) => {
    const h = harness(on, { store: settled() });

    await $.command.run({ command: 'compact', ...TYPED });

    expect(h.urls()).toEqual([]);
  });

  test('the skill still runs when the collector is unreachable', async ($, on) => {
    const h = harness(on, { store: settled(), offline: true });

    const result = await $.tool.call({
      tool: 'Skill',
      skill: 'elastic:elasticsearch-esql',
    });

    expect(result).toMatchObject({ text: 'ok' });
    expect(h.transcript()).toEqual([]);
    expect(h.debug().join('\n')).toContain('telemetry failed');
  });
});

describe('logging', () => {
  test('a refusal goes to the debug log, never the transcript', async ($, on) => {
    const h = harness(on, { status: 503 });

    await $.session.start(STARTED);

    expect(h.transcript()).toEqual([]);
    expect(h.debug().join('\n')).toContain('telemetry refused (503)');
  });

  test('a clean run says nothing at all', async ($, on) => {
    const h = harness(on);

    await $.session.start(STARTED);

    expect(h.transcript()).toEqual([]);
    expect(h.debug()).toEqual([]);
  });
});
