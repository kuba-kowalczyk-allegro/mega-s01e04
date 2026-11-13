import { describe, expect, it } from 'vitest';
import type { Status } from '../src/status.js';
import { StatusBoard } from '../src/views/status.js';

const status: Status = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  lastBeat: null,
  nights: ['2026-10-28'],
};

describe('status board night summaries', () => {
  it('keeps links and displays unavailable counts for legacy status values', () => {
    const html = StatusBoard({ status }).toString();
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('ok — / retry — / fail —');
  });

  it('does not turn a vanished night into an empty night', () => {
    const html = StatusBoard({
      status: { ...status, nightSummaries: { '2026-10-28': null } },
    }).toString();
    expect(html).toContain('ok — / retry — / fail —');
    expect(html).not.toContain('ok 0');
  });

  it('shows genuine zero counts for an empty night', () => {
    const html = StatusBoard({
      status: { ...status, nightSummaries: { '2026-10-28': { ok: 0, retry: 0, fail: 0 } } },
    }).toString();
    expect(html).toContain('ok 0 / retry 0 / fail 0');
  });
});
