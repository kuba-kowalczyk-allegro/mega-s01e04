import { describe, expect, it } from 'vitest';
import type { DigestNight, DigestRow } from '../src/digest/types.js';
import { Digest } from '../src/views/digest.js';

const row: DigestRow = {
  job: 'backup',
  owner: 'rook',
  runs: 5,
  retries: 3,
  lastStatus: 'fail',
  lastError: 'disk full',
  firstAt: '2026-10-28T22:15:00+02:00',
  lastAt: '2026-10-29T03:10:00-04:00',
};

function render(rows: DigestRow[], malformedLines = 0) {
  const digest: DigestNight = {
    night: '2026-10-28',
    rows,
    counts: { ok: 0, retry: 0, fail: 0 },
    malformedLines,
  };
  return (<Digest digest={digest} />).toString();
}

describe('digest view', () => {
  it('renders every row field and preserves the shared row order and timestamp offsets', async () => {
    const html = await render([row, { ...row, job: 'sync', owner: null, lastError: null }]);

    expect(html).toContain('digest · 2026-10-28');
    expect(html.match(/<table>/g)).toHaveLength(1);
    for (const heading of ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first time', 'last time']) {
      expect(html).toContain(`<th scope="col">${heading}</th>`);
    }
    for (const value of ['backup', 'rook', '5', 'disk full', row.firstAt, row.lastAt]) {
      expect(html).toContain(`<td>${value}</td>`);
    }
    expect(html.indexOf('<td>backup</td>')).toBeLessThan(html.indexOf('<td>sync</td>'));
    expect(html.match(/<td>—<\/td>/g)).toHaveLength(2);
  });

  it('marks high retries and failure with warning styling and visible text', async () => {
    const html = await render([row]);
    expect(html).toContain('<td class="warn">3 (high retries)</td>');
    expect(html).toContain('<td class="warn">fail</td>');

    for (const lastStatus of ['ok', 'retry'] as const) {
      const ordinary = await render([{ ...row, retries: 2, lastStatus }]);
      expect(ordinary).toContain('<td>2</td>');
      expect(ordinary).toContain(`<td>${lastStatus}</td>`);
      expect(ordinary).not.toContain('class="warn"');
    }
    expect(await render([{ ...row, retries: 4 }])).toContain('4 (high retries)');
  });

  it('renders an empty night without a table', async () => {
    const html = await render([]);
    expect(html).toContain('nothing ran');
    expect(html).toContain('malformed lines: 0');
    expect(html).not.toContain('<table>');
  });

  it('reports malformed lines even when no valid jobs remain', async () => {
    for (const rows of [[], [row]]) {
      const html = await render(rows, 2);
      expect(html).toContain('<p class="warn">malformed lines: 2</p>');
    }
    expect(await render([], 2)).toContain('nothing ran');
  });

  it('escapes log strings rather than rendering markup', async () => {
    const payload = '<script>alert("log")</script>';
    const html = await render([{ ...row, job: payload, owner: payload, lastError: payload }]);
    expect(html).not.toContain('<script>');
    expect(html.match(/&lt;script&gt;/g)).toHaveLength(3);
    expect(html).toContain('&quot;log&quot;');
  });
});
