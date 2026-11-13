import { serve } from '@hono/node-server';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Hono } from 'hono';

// Reject pages that need a second file or client JS. Navigation links are fine.
export function validatePreview(html: string, markerSet: boolean): void {
  if (!/^<!doctype html>/i.test(html) || !/<style[\s>]/i.test(html)) {
    throw new Error('Preview must be a complete HTML document with inline CSS.');
  }
  if (/<(?:script|link|iframe|object|embed)\b|\bsrc\s*=|\bsrcset\s*=|url\s*\(|@import\b/i.test(html)) {
    throw new Error('Preview must be self-contained, with no client scripts.');
  }
  const banner = html.match(/<span\s+class="marker">([^<]*)<\/span>/)?.[1];
  if (!banner || (!markerSet && banner !== 'no marker set')) {
    throw new Error('Preview lane banner is missing or does not match cleanup mode.');
  }
}

export async function exportPreview(app: Hono, outputDir: string, markerSet: boolean): Promise<void> {
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const output = join(outputDir, 'index.html');
  // A failed export must not leave an older marker-bearing page ready to upload.
  await rm(output, { force: true });
  if ((await readdir(outputDir)).length !== 0) {
    throw new Error('Preview output directory contains unexpected files.');
  }
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('rig did not bind a local port.');
    const response = await fetch(`http://127.0.0.1:${address.port}/digest/2026-10-28`, {
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Digest export failed (HTTP ${response.status}).`);
    if (!response.headers.get('content-type')?.startsWith('text/html')) {
      throw new Error('Digest export did not return HTML.');
    }
    const html = await response.text();
    validatePreview(html, markerSet);
    await writeFile(output, html, { mode: 0o600 });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      if ('closeAllConnections' in server) server.closeAllConnections();
    });
  }
}
