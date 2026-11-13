import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import * as reader from '../src/digest/read-night.js';
import { readStatus } from '../src/status.js';

const config = {
  adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs',
};
const temporaryDirs: string[] = [];

function temporaryRuns() {
  const runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
  temporaryDirs.push(runsDir);
  return runsDir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('status board digest links', () => {
  it('lists both sample nights newest first with valid-event counts', async () => {
    const status = readStatus(config);
    expect(status.nights).toEqual(['2026-10-28', '2026-10-27']);
    expect(status.nightSummaries).toEqual({
      '2026-10-28': { ok: 10, retry: 4, fail: 1 },
      '2026-10-27': { ok: 7, retry: 0, fail: 0 },
    });
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    const nights = html.match(/<li>.*?<\/li>/g);
    expect(nights).toHaveLength(2);
    expect(nights?.[0]).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(nights?.[0]).toContain('ok 10 / retry 4 / fail 1');
    expect(nights?.[1]).toContain('<a href="/digest/2026-10-27">2026-10-27</a>');
    expect(nights?.[1]).toContain('ok 7 / retry 0 / fail 0');
  });

  it('counts events rather than final job statuses and skips invalid lines', async () => {
    const runsDir = temporaryRuns();
    const event = { at: '2026-10-28T23:00:00+01:00', job: 'same-job', owner: null };
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ ...event, status: 'retry' }),
      JSON.stringify({ ...event, status: 'retry' }),
      JSON.stringify({ ...event, status: 'fail' }),
      JSON.stringify({ ...event, status: 'ok' }),
      JSON.stringify({ ...event, status: 'ok', owner: 42 }),
      '{bad json',
      '',
    ].join('\n'));
    expect(readStatus({ ...config, runsDir }).nightSummaries).toEqual({
      '2026-10-28': { ok: 1, retry: 2, fail: 1 },
    });
    const html = await (await createApp({ ...config, runsDir }).request('/')).text();
    expect(html).toContain('ok 1 / retry 2 / fail 1');
  });

  it('distinguishes an empty night from a vanished file', () => {
    const runsDir = temporaryRuns();
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), '');
    expect(readStatus({ ...config, runsDir }).nightSummaries).toEqual({
      '2026-10-28': { ok: 0, retry: 0, fail: 0 },
    });
    vi.spyOn(reader, 'readNight').mockReturnValueOnce(null);
    const status = readStatus({ ...config, runsDir });
    expect(status.nights).toEqual(['2026-10-28']);
    expect(status.nightSummaries).toEqual({ '2026-10-28': null });
  });

  it('preserves the empty-board message when the runs directory is missing', async () => {
    const runsDir = join(temporaryRuns(), 'missing');
    const res = await createApp({ ...config, runsDir }).request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing in runs/');
    expect(readStatus({ ...config, runsDir }).nights).toEqual([]);
  });
});
