import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type Event = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function isCalendarDate(value: string): boolean {
  if (value.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function isTimestamp(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || match[0] !== value || !isCalendarDate(match[1])) return false;
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return false;
  const offset = match[5];
  return offset === 'Z' || (Number(offset.slice(1, 3)) <= 23 && Number(offset.slice(4, 6)) <= 59);
}

function isEvent(value: unknown): value is Event {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.job === 'string' && event.job.length > 0
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (typeof event.owner === 'string' || event.owner === null)
    && typeof event.at === 'string' && isTimestamp(event.at)
    && (!Object.hasOwn(event, 'error') || typeof event.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isCalendarDate(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, DigestRow>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let malformedLines = 0;

  for (const line of contents.split('\n')) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      malformedLines++;
      continue;
    }
    if (!isEvent(event)) {
      malformedLines++;
      continue;
    }

    counts[event.status]++;
    const row = jobs.get(event.job);
    if (row) {
      row.owner = event.owner;
      row.runs++;
      row.retries += Number(event.status === 'retry');
      row.lastStatus = event.status;
      if (event.error !== undefined) row.lastError = event.error;
      row.lastAt = event.at;
    } else {
      jobs.set(event.job, {
        job: event.job,
        owner: event.owner,
        runs: 1,
        retries: Number(event.status === 'retry'),
        lastStatus: event.status,
        lastError: event.error ?? null,
        firstAt: event.at,
        lastAt: event.at,
      });
    }
  }

  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, counts, malformedLines };
};
