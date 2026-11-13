import { createApp } from '../src/app.js';
import { exportPreview } from '../src/preview/export.js';

// Deliberately do not load .env: cleanup must not recover a marker from disk.
const markerSet = Boolean(process.env.LANE_MARKER?.trim());
if (!markerSet) delete process.env.LANE_MARKER;

try {
  await exportPreview(createApp(), '.tmp/preview', markerSet);
  console.log('Digest exported to ignored .tmp/preview/index.html (HTML not logged).');
} catch {
  // Never print response bodies, environment values, or errors carrying lane data.
  console.error('Digest export failed; check that the digest route is implemented and self-contained.');
  process.exitCode = 1;
}
