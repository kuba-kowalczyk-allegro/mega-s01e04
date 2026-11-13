import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestNight, DigestRow } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T01:00:00+05:30';
const lastAt = '2026-10-28T03:00:00-04:00';

function event(job: string, status = 'ok', owner: string | null = 'reader', at = firstAt) {
  return { at, job, status, owner };
}

// Inspect table text without imposing a particular column order or nested markup.
function text(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (_, entity: string) => {
      if (entity.startsWith('#')) {
        return String.fromCodePoint(entity[1].toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10));
      }
      const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      return entities[entity.toLowerCase()];
    },
  ).trim();
}

function tableRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(([markup]) => ({
      markup,
      cells: [...markup.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => text(cell[1])),
    }))
    .filter((row) => row.cells.length > 0);
}

function expectRowFields(cells: string[], row: DigestRow) {
  const remaining = [...cells];
  for (const value of [
    row.job, row.owner ?? '—', String(row.runs), String(row.retries),
    row.lastStatus, row.lastError ?? '—', row.firstAt, row.lastAt,
  ]) {
    expect(remaining, `visible field ${value} for ${row.job}`).toContain(value);
    remaining.splice(remaining.indexOf(value), 1);
  }
}

describe('digest routes', () => {
  let runsDir: string;
  let config: RigConfig;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    config = { adapter: 'shim', installed: firstAt, beatEverySeconds: 60, runsDir };
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeNight(lines: unknown[], date = night) {
    writeFileSync(join(runsDir, `${date}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  }

  function populatedNight(): DigestNight {
    // Deliberately neither locale-sorted nor grouped by job. Later events retain
    // the original offsets and the most recent supplied error.
    writeNight([
      event('zeta', 'fail'),
      { ...event('alpha', 'retry'), error: 'try again' },
      event('beta', 'retry'),
      event('Beta', 'ok', null),
      event('alpha', 'retry'),
      event('beta', 'retry'),
      event('alpha', 'retry'),
      event('beta', 'ok', 'reader', lastAt),
      event('alpha', 'ok', 'reader', lastAt),
    ]);
    return {
      night,
      rows: [
        { job: 'Beta', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt, lastAt: firstAt },
        { job: 'alpha', owner: 'reader', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'try again', firstAt, lastAt },
        { job: 'beta', owner: 'reader', runs: 3, retries: 2, lastStatus: 'ok', lastError: null, firstAt, lastAt },
        { job: 'zeta', owner: 'reader', runs: 1, retries: 0, lastStatus: 'fail', lastError: null, firstAt, lastAt: firstAt },
      ],
      counts: { ok: 3, retry: 5, fail: 1 },
      malformedLines: 0,
    };
  }

  it('returns the full JSON contract, counting events and preserving nulls and offsets', async () => {
    const expected = populatedNight();
    const response = await createApp(config).request(`/api/digest/${night}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual(expected);
  });

  it('renders all fields in one table in the same job order as JSON, using the usual layout', async () => {
    const expected = populatedNight();
    const app = createApp(config);
    const response = await app.request(`/digest/${night}`);
    const jsonResponse = await app.request(`/api/digest/${night}`);

    expect(response.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    const digest = await jsonResponse.json() as DigestNight;
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toMatch(/<header\b/i);
    expect(html).toContain('lane-07');
    expect(html).toMatch(/<main\b/i);
    expect(html).toMatch(/<style\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(text(html)).toContain(night);
    expect(html.match(/<table\b/gi)).toHaveLength(1);

    const rows = tableRows(html);
    expect(rows).toHaveLength(expected.rows.length);
    const jobs = rows.map((row) => expected.rows.find((item) => row.cells.includes(item.job))?.job);
    expect(jobs).toEqual(['Beta', 'alpha', 'beta', 'zeta']);
    expect(jobs).toEqual(digest.rows.map((row) => row.job));
    expected.rows.forEach((row, index) => expectRowFields(rows[index].cells, row));
  });

  it('marks three retries and final failure with .warn, but not two retries ending ok', async () => {
    populatedNight();
    const response = await createApp(config).request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const rows = tableRows(await response.text());
    const warningClass = /class\s*=\s*["'][^"']*\bwarn\b[^"']*["']/i;

    for (const job of ['alpha', 'zeta']) {
      const row = rows.find((item) => item.cells.includes(job));
      expect(row, `row for ${job}`).toBeDefined();
      expect(row?.markup).toMatch(warningClass);
    }
    const belowThreshold = rows.find((row) => row.cells.includes('beta'));
    expect(belowThreshold).toBeDefined();
    expect(belowThreshold?.markup).not.toMatch(warningClass);
  });

  it.each(['/digest', '/api/digest'])('%s returns 404 for a missing night', async (route) => {
    const response = await createApp(config).request(`${route}/${night}`);
    expect(response.status).toBe(404);
  });

  it.each(['2026-02-30', '2026-13-01', 'not-a-night', '2026-1-02'])(
    'rejects invalid night %s even if a matching file exists', async (invalidNight) => {
      writeNight([event('not readable')], invalidNight);
      const app = createApp(config);
      for (const route of ['/digest', '/api/digest']) {
        expect((await app.request(`${route}/${invalidNight}`)).status).toBe(404);
      }
    },
  );

  it.each(['', '\n  \n\t\n'])('serves an empty or blank night (%j) without inventing rows', async (contents) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    const htmlResponse = await app.request(`/digest/${night}`);

    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({ night, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, malformedLines: 0 });
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(text(html)).toMatch(/nothing ran/i);
    expect(tableRows(html)).toEqual([]);
  });

  it.each([false, true])('reports malformed lines without failing (all bad: %s)', async (allBad) => {
    const validEvent = event('survivor', 'ok', null);
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      '', 'not json', '  ', JSON.stringify({ at: firstAt, job: 'missing owner', status: 'ok' }),
      ...(allBad ? [] : [JSON.stringify(validEvent)]), '',
    ].join('\n'));
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    const htmlResponse = await app.request(`/digest/${night}`);

    expect(jsonResponse.status).toBe(200);
    const expectedRows: DigestRow[] = allBad ? [] : [{
      job: 'survivor', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt, lastAt: firstAt,
    }];
    expect(await jsonResponse.json()).toEqual({
      night, rows: expectedRows, counts: { ok: allBad ? 0 : 1, retry: 0, fail: 0 }, malformedLines: 2,
    });
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    // Accept either label-first or count-first wording, without a markup contract.
    expect(text(html)).toMatch(/(?:\b2\b[^.!\n]*malformed|malformed[^.!\n]*\b2\b)/i);
    expect(tableRows(html)).toHaveLength(expectedRows.length);
    if (allBad) expect(text(html)).toMatch(/nothing ran/i);
    else expectRowFields(tableRows(html)[0].cells, expectedRows[0]);
  });

  it('escapes job, owner and error in HTML while preserving their original JSON values', async () => {
    const job = '<script>job & "quoted"</script>';
    const owner = '<img src=x onerror="alert(1)">';
    const error = '<svg onload="alert(2)">error & details</svg>';
    writeNight([{ ...event(job, 'fail', owner), error }]);
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    const htmlResponse = await app.request(`/digest/${night}`);

    expect(jsonResponse.status).toBe(200);
    const expectedRow: DigestRow = {
      job, owner, runs: 1, retries: 0, lastStatus: 'fail', lastError: error, firstAt, lastAt: firstAt,
    };
    expect(await jsonResponse.json()).toEqual({ night, rows: [expectedRow], counts: { ok: 0, retry: 0, fail: 1 }, malformedLines: 0 });
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).not.toMatch(/<(?:script|img|svg)\b/i);
    for (const value of [job, owner, error]) expect(html).not.toContain(value);
    const rows = tableRows(html);
    expect(rows).toHaveLength(1);
    expectRowFields(rows[0].cells, expectedRow);
  });
});
