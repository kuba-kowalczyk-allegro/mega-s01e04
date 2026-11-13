export type DigestStatus = 'ok' | 'retry' | 'fail';

// Counts of valid log events, not jobs or their final statuses.
export type DigestCounts = Record<DigestStatus, number>;

/** One job, aggregated in file order (not timestamp order). */
export type DigestRow = {
  job: string;
  // Owner of the last valid event, including an explicit null.
  owner: string | null;
  // All valid events for this job, including retries and failures.
  runs: number;
  // Valid events whose status is retry.
  retries: number;
  lastStatus: DigestStatus;
  // Most recent supplied error string; later events without error do not clear it.
  // Null if no valid event for this job supplied an error (even after a failure).
  lastError: string | null;
  // Original at strings from the first/last valid events; preserve their offsets.
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  night: string;
  // One row per exact job string, ascending by JS string comparison (< / >),
  // case-sensitive and locale-independent. Both HTML and JSON use this order.
  rows: DigestRow[];
  counts: DigestCounts;
  malformedLines: number;
};

export type DigestResult = DigestNight | null;

/**
 * Synchronously read runsDir/<night>.jsonl. This is a contract, not a reader.
 *
 * night must be a real calendar date written YYYY-MM-DD. Invalid input (including
 * path separators/traversal) returns null without reading outside runsDir.
 * A missing file or missing runsDir returns null; other I/O errors propagate.
 * An empty/blank file returns a DigestNight with [], zero counts and zero
 * malformedLines, distinct from null. A file with only bad lines also has [],
 * but reports those lines in malformedLines.
 *
 * Ignore blank/whitespace-only lines, including a trailing newline. Count each
 * other line once as malformed if JSON parsing fails or its event is invalid;
 * skip it without throwing or changing rows/counts.
 *
 * A valid event is a non-null, non-array object with a non-empty string job,
 * status ok/retry/fail, owner string or null, and at an ISO 8601 datetime with
 * an explicit offset (Z or +/-HH:MM) representing a valid timestamp. Optional
 * error must be a string if present. Missing required fields or wrong types
 * invalidate the entire event; unknown fields are ignored. Preserve strings
 * verbatim, without trimming or converting timestamps to UTC.
 *
 * Aggregate valid events in file order, then sort rows by job as specified
 * above. counts includes every valid event once in its status bucket, so its
 * total equals the sum of row.runs; malformed lines never contribute.
 */
export type ReadNight = (runsDir: string, night: string) => DigestResult;
