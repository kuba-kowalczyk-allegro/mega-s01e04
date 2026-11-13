import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { exportPreview, validatePreview } from '../src/preview/export.js';
import { Layout } from '../src/views/layout.js';

const directories: string[] = [];
async function outputDir() {
  const path = await mkdtemp(join(tmpdir(), 'rig-preview-'));
  directories.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

// Exporter fixtures only: these do not implement or stand in for digest route tests.
function fixture(marker: string | null = null) {
  const app = new Hono();
  app.get('/digest/2026-10-28', (c) => c.html(
    <Layout title="export fixture" lane={{ id: 'test', marker }}>
      <p>Exporter fixture</p>
    </Layout>,
  ));
  return app;
}

describe('preview export', () => {
  it('saves one self-contained HTML file with the cleanup banner over local HTTP', async () => {
    const path = await outputDir();
    await exportPreview(fixture(), path, false);
    expect(await readdir(path)).toEqual(['index.html']);
    const html = await readFile(join(path, 'index.html'), 'utf8');
    expect(html).toContain('no marker set');
    expect(html).toContain('<style>');
  });

  it('preserves a supplied banner without a tracked marker value', async () => {
    const marker = randomUUID();
    const path = await outputDir();
    await exportPreview(fixture(marker), path, true);
    expect(await readFile(join(path, 'index.html'), 'utf8')).toContain(marker);
  });

  it('rejects a missing route and removes stale output', async () => {
    const path = await outputDir();
    await writeFile(join(path, 'index.html'), 'stale');
    await expect(exportPreview(new Hono(), path, false)).rejects.toThrow('HTTP 404');
    expect(await readdir(path)).toEqual([]);
  });

  it('rejects a non-HTML response without saving its body', async () => {
    const path = await outputDir();
    const app = new Hono().get('/digest/2026-10-28', (c) => c.json({ ok: true }));
    await expect(exportPreview(app, path, false)).rejects.toThrow('did not return HTML');
    expect(await readdir(path)).toEqual([]);
  });

  it('refuses to mix the exported page with other upload files', async () => {
    const path = await outputDir();
    await writeFile(join(path, 'unexpected.txt'), 'not a preview');
    await expect(exportPreview(fixture(), path, false)).rejects.toThrow('unexpected files');
    expect(await readdir(path)).toEqual(['unexpected.txt']);
  });

  it('rejects redirects rather than exporting a different page', async () => {
    const path = await outputDir();
    const app = new Hono().get('/digest/2026-10-28', (c) => c.redirect('/'));
    await expect(exportPreview(app, path, false)).rejects.toThrow();
    expect(await readdir(path)).toEqual([]);
  });
});

describe('preview validation', () => {
  const html = '<!doctype html><html><style>body { color: black; }</style><span class="marker">no marker set</span></html>';

  it.each([
    '<script>alert(1)</script>',
    '<img src="outside.png">',
    '<link rel="stylesheet" href="outside.css">',
    '<style>@import "outside.css";</style>',
    '<style>body { background: url(outside.png); }</style>',
  ])('rejects a rendering dependency: %s', (dependency) => {
    expect(() => validatePreview(html + dependency, false)).toThrow('self-contained');
  });

  it('requires a banner and verifies the cleanup banner', () => {
    expect(() => validatePreview(html.replace('no marker set', ''), false)).toThrow('banner');
    expect(() => validatePreview(html.replace('no marker set', randomUUID()), false)).toThrow('banner');
    expect(() => validatePreview('<p>not a document</p>', false)).toThrow('complete HTML');
  });
});
