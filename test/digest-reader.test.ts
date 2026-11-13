import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const night = '2026-10-28';
const at = '2026-10-28T23:00:02+01:00';
const event = { at, job: 'job', status: 'ok', owner: 'owner' };
let runsDir: string;

function writeLines(lines: unknown[]): void {
  writeFileSync(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
}

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-reader-'));
});

afterEach(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the real fixture as five jobs, fifteen valid events and one malformed line', () => {
    const fixtureDir = fileURLToPath(new URL('../runs/', import.meta.url));
    const result = readNight(fixtureDir, night);
    expect(result).toEqual({
      night,
      counts: { ok: 10, retry: 4, fail: 1 },
      malformedLines: 1,
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: at, lastAt: at },
      ],
    });
  });

  it('aggregates in file order, preserves offsets and retains the most recent supplied error', () => {
    const firstAt = '2026-10-29T03:00:00.123+05:30';
    const lastAt = '2026-10-27T01:00:00-03:30';
    writeLines([
      { ...event, at: firstAt, status: 'fail', error: 'first' },
      { ...event, status: 'retry', error: 'latest', owner: 'new owner' },
      { ...event, at: lastAt, owner: null },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      night, counts: { ok: 1, retry: 1, fail: 1 }, malformedLines: 0,
      rows: [{ job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest', firstAt, lastAt }],
    });
  });

  it('keeps empty error strings, null initial owners and failures without supplied errors', () => {
    writeLines([
      { ...event, status: 'fail', owner: null },
      { ...event, job: 'empty-error', error: 'old' },
      { ...event, job: 'empty-error', error: '' },
      { ...event, job: 'empty-error' },
    ]);
    expect(readNight(runsDir, night)?.rows).toMatchObject([
      { job: 'empty-error', lastError: '', runs: 3 },
      { job: 'job', owner: null, lastError: null, lastStatus: 'fail' },
    ]);
  });

  it('sorts exact job strings by locale-independent JS comparison and handles special keys', () => {
    const jobs = ['é', 'a', 'Z', '__proto__', 'constructor', 'A', ' a ', 'a '];
    writeLines(jobs.map((job) => ({ ...event, job, owner: ' owner ', extra: { ignored: true } })));
    const result = readNight(runsDir, night);
    expect(result?.rows.map((row) => row.job)).toEqual([' a ', 'A', 'Z', '__proto__', 'a', 'a ', 'constructor', 'é']);
    expect(result?.rows.every((row) => row.owner === ' owner ' && row.runs === 1)).toBe(true);
    expect(result?.counts).toEqual({ ok: jobs.length, retry: 0, fail: 0 });
  });

  it.each(['', '\n  \n\t\r\n'])('distinguishes empty/blank files from missing files (%j)', (contents) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    expect(readNight(runsDir, night)).toEqual({ night, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, malformedLines: 0 });
  });

  it('counts malformed JSON once per nonblank line, handles CRLF and continues reading', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), `\r\nnot json\r\n{"incomplete":\r\n${JSON.stringify(event)}\r\n\t\r\n`);
    const result = readNight(runsDir, night);
    expect(result?.malformedLines).toBe(2);
    expect(result?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(result?.rows).toHaveLength(1);
  });

  it.each([
    null, [], [event], 'text', 4, true, {},
    { ...event, job: '' }, { ...event, job: 1 },
    { ...event, status: 'unknown' }, { ...event, status: null },
    { ...event, owner: 1 }, { ...event, owner: false },
    { ...event, at: null }, { ...event, at: 1 },
    { ...event, error: null }, { ...event, error: 1 },
    ...['job', 'at', 'owner', 'status'].map((key) => Object.fromEntries(Object.entries(event).filter(([name]) => name !== key))),
  ])('counts an invalid event without affecting valid aggregation: %j', (invalid) => {
    writeLines([event, invalid, { ...event, status: 'retry' }]);
    const result = readNight(runsDir, night);
    expect(result?.malformedLines).toBe(1);
    expect(result?.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(result?.rows).toMatchObject([{ job: 'job', runs: 2, retries: 1, lastStatus: 'retry', owner: 'owner', lastError: null }]);
  });

  it('returns an empty digest with a malformed count for an entirely invalid file', () => {
    writeLines([null, {}, []]);
    expect(readNight(runsDir, night)).toEqual({ night, rows: [], counts: { ok: 0, retry: 0, fail: 0 }, malformedLines: 3 });
  });

  it.each([
    '2026-02-29T12:00:00Z', '1900-02-29T12:00:00Z', '2026-04-31T12:00:00Z',
    '2026-00-01T12:00:00Z', '2026-13-01T12:00:00Z', '2026-01-00T12:00:00Z',
    '2026-10-28T24:00:00Z', '2026-10-28T12:60:00Z', '2026-10-28T12:00:60Z',
    '2026-10-28T12:00:00+24:00', '2026-10-28T12:00:00-24:00',
    '2026-10-28T12:00:00+01:60', '2026-10-28T12:00:00-01:60',
    '2026-10-28T12:00:00', '2026-10-28', '2026-10-28 12:00:00Z',
    '2026-10-28T12:00:00+0100', '2026-10-28T12:00:00+1:00',
    '2026-10-28T12:00:00.Z', '2026-10-28T12:00:00Z trailing', ' 2026-10-28T12:00:00Z',
    '2026-10-28T12:00:00Z\n',
  ])('rejects invalid timestamp %s without normalizing it', (timestamp) => {
    writeLines([{ ...event, at: timestamp }]);
    expect(readNight(runsDir, night)).toMatchObject({ rows: [], counts: { ok: 0, retry: 0, fail: 0 }, malformedLines: 1 });
  });

  it.each([
    '2000-02-29T12:00:00Z', '2024-02-29T23:59:59.123456789+23:59',
    '2026-10-28T00:00:00-23:59', '2026-10-28T12:00+00:00', '2026-10-28T12:00:00-00:00',
  ])('accepts and preserves a valid timestamp %s', (timestamp) => {
    writeLines([{ ...event, at: timestamp }]);
    expect(readNight(runsDir, night)).toMatchObject({ malformedLines: 0, rows: [{ firstAt: timestamp, lastAt: timestamp }] });
  });

  it.each([
    '', '../2026-10-28', 'dir/2026-10-28', 'dir\\2026-10-28', '/2026-10-28',
    '2026-10-28.jsonl', '2026-1-01', '2026-01-1', ' 2026-10-28', '2026-10-28\n',
    '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01',
    '2026-01-00', '2026-01-32', '2026-10-28\0',
  ])('returns null before filesystem access for invalid night %j', (invalidNight) => {
    // A valid read against this non-directory would throw ENOTDIR.
    const notDirectory = join(runsDir, 'not-a-directory');
    writeFileSync(notDirectory, '');
    expect(readNight(notDirectory, invalidNight)).toBeNull();
  });

  it.each(['2000-02-29', '2024-02-29', '2026-04-30', '0096-02-29'])('accepts real calendar night %s', (validNight) => {
    writeFileSync(join(runsDir, `${validNight}.jsonl`), '');
    expect(readNight(runsDir, validNight)?.night).toBe(validNight);
  });

  it('returns null for missing files and missing runs directories', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
  });

  it('propagates non-ENOENT I/O errors', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow(expect.objectContaining({ code: 'EISDIR' }));
    const notDirectory = join(runsDir, 'not-a-directory');
    writeFileSync(notDirectory, '');
    expect(() => readNight(notDirectory, night)).toThrow(expect.objectContaining({ code: 'ENOTDIR' }));
  });
});
