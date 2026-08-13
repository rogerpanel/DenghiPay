import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * API documentation.
 *
 * Serves the committed OpenAPI document and a self-contained viewer. No CDN,
 * no external script: a page that reaches out to unpkg to render is a page
 * that breaks behind a corporate proxy, leaks a request to a third party, and
 * would need a hole in the CSP.
 */
@Controller()
export class DocsController {
  private cached: string | null = null;

  private spec(): string {
    if (this.cached !== null) return this.cached;
    // Alongside dist/ in the image, and four levels up in a source checkout.
    const candidates = [
      resolve(process.cwd(), '../../docs/api/openapi.json'),
      resolve(__dirname, '../../../../docs/api/openapi.json'),
      resolve(process.cwd(), 'docs/api/openapi.json'),
    ];
    for (const path of candidates) {
      try {
        this.cached = readFileSync(path, 'utf8');
        return this.cached;
      } catch {
        continue;
      }
    }
    throw new NotFoundException({
      code: 'SPEC_NOT_FOUND',
      message: 'The OpenAPI document is not available. Run `pnpm openapi`.',
    });
  }

  @Get('openapi.json')
  @Header('content-type', 'application/json')
  openapi(): string {
    return this.spec();
  }

  @Get('docs')
  @Header('content-type', 'text/html; charset=utf-8')
  docs(): string {
    const document = JSON.parse(this.spec()) as {
      info: { title: string; version: string; description?: string };
      paths: Record<
        string,
        Record<string, { summary?: string; description?: string; tags?: string[] }>
      >;
    };

    const byTag = new Map<
      string,
      Array<{ method: string; path: string; summary: string; description: string }>
    >();
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const tag = operation.tags?.[0] ?? 'Other';
        const list = byTag.get(tag) ?? [];
        list.push({
          method: method.toUpperCase(),
          path,
          summary: operation.summary ?? '',
          description: operation.description ?? '',
        });
        byTag.set(tag, list);
      }
    }

    const sections = [...byTag.entries()]
      .map(
        ([tag, operations]) => `
      <section>
        <h2>${escapeHtml(tag)}</h2>
        ${operations
          .map(
            (op) => `
          <article class="op">
            <div class="line">
              <span class="method method--${op.method.toLowerCase()}">${op.method}</span>
              <code>${escapeHtml(op.path)}</code>
            </div>
            <p class="summary">${escapeHtml(op.summary)}</p>
            ${op.description === '' ? '' : `<p class="desc">${escapeHtml(op.description)}</p>`}
          </article>`,
          )
          .join('')}
      </section>`,
      )
      .join('');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.info.title)} — API</title>
<style>
  :root {
    --brand-500:#F5A623; --brand-700:#B36A00; --brand-800:#A85C00; --brand-900:#6B3A00;
    --ink:#1A1A1A; --muted:#5C5C5C; --line:#E6E6E6; --surface:#fff; --sunken:#FAF9F7;
  }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#F5F2EC; --muted:#B3ADA1; --line:#35301F; --surface:#17150F; --sunken:#221F18;
            --brand-700:#FBC96B; --brand-800:#FBC96B; --brand-900:#FBC96B; }
  }
  * { box-sizing: border-box }
  body { margin:0; background:var(--surface); color:var(--ink); line-height:1.55;
         font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif }
  .wrap { max-width: 60rem; margin: 0 auto; padding: 2rem 1rem 4rem }
  h1 { color:var(--brand-900); margin:0 0 .25rem }
  h2 { color:var(--brand-900); font-size:1.25rem; margin:2.5rem 0 .75rem;
       border-bottom:1px solid var(--line); padding-bottom:.4rem }
  .lede { color:var(--muted); white-space:pre-wrap; margin:0 0 1rem }
  .op { border:1px solid var(--line); border-radius:12px; padding:.85rem 1rem; margin-bottom:.6rem;
        background:var(--sunken) }
  .line { display:flex; align-items:center; gap:.6rem; flex-wrap:wrap }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.95rem }
  .method { font-size:.7rem; font-weight:800; letter-spacing:.04em; padding:2px 8px;
            border-radius:999px; background:var(--brand-500); color:#1A1A1A }
  .method--get { background:#D6E9FF; color:#0B4C8C }
  .method--post { background:var(--brand-500); color:#1A1A1A }
  .summary { margin:.4rem 0 0; font-weight:600 }
  .desc { margin:.3rem 0 0; color:var(--muted); font-size:.92rem }
  .badge { display:inline-block; background:var(--brand-500); color:#1A1A1A; font-weight:700;
           font-size:.75rem; padding:2px 10px; border-radius:999px }
  a { color:var(--brand-800) }
</style>
</head>
<body>
  <div class="wrap">
    <span class="badge">No live funds</span>
    <h1>${escapeHtml(document.info.title)}</h1>
    <p class="lede">${escapeHtml(document.info.description ?? '')}</p>
    <p><a href="/openapi.json">openapi.json</a> · version ${escapeHtml(document.info.version)}</p>
    ${sections}
  </div>
</body>
</html>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
