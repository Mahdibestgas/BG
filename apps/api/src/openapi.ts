import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from './http';

const ok = { description: 'OK' };
const planId = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const err = { '401': { description: 'Missing, invalid, revoked or expired key' }, '403': { description: 'Key not allowed on this route, or write attempted' }, '404': { description: 'Not found (also returned for another company\'s data)' }, '429': { description: 'Rate limited; see Retry-After' } };

/** The public, read-only API for other systems. Written by hand so it never drifts into internal routes. */
export const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Cash Flow 13 API', version: '1.0.0', description: 'Read-only access to your company\'s cash flow plans. Create a key under API access (owners only). Send it as `Authorization: Bearer cf13k_...`. A key sees only its own company, cannot write, and expires (max 365 days). Amounts are in the plan currency (SAR); weeks start on the dates returned.' },
  servers: [{ url: '/' }],
  components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'cf13k_... key created by a company owner' } } },
  security: [{ apiKey: [] }],
  paths: {
    '/api/plans': { get: { summary: 'List the company\'s plans', operationId: 'listPlans', responses: { '200': ok, ...err } } },
    '/api/plans/{id}': { get: { summary: 'One plan with its full model (assumptions, schedules, variance block)', operationId: 'getPlan', parameters: [planId], responses: { '200': ok, ...err } } },
    '/api/plans/{id}/forecast': { get: { summary: 'The computed forecast: weeks, L1 totals, L2 lines, L3 rows, VAT, checks, headline numbers', operationId: 'getForecast', parameters: [planId, { name: 'fromWeek', in: 'query', schema: { type: 'integer', minimum: 0 } }], responses: { '200': ok, ...err } } },
    '/api/plans/{id}/items': { get: { summary: 'L4: the individual items behind one L3 row, week by week', operationId: 'getItems', parameters: [planId, { name: 'cat', in: 'query', required: true, schema: { type: 'string', example: 'P_RENT' } }, { name: 'l3', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': ok, ...err } } },
    '/api/plans/{id}/approvals': { get: { summary: 'Board approvals recorded for the plan, newest first', operationId: 'getApprovals', parameters: [planId], responses: { '200': ok, ...err } } }
  }
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]);

@Controller('api')
export class DocsController {
  @Public() @Get('openapi.json')
  spec() { return SPEC; }

  @Public() @Get('docs') @Header('Cache-Control', 'public, max-age=300')
  docs(@Res() res: Response) {
    const rows = Object.entries(SPEC.paths).map(([p, v]) => { const g = (v as any).get; return `<tr><td><code>GET ${esc(p)}</code></td><td>${esc(g.summary)}</td></tr>`; }).join('');
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cash Flow 13 API</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#1d2a1f}code,pre{background:#f1eee4;border-radius:6px;padding:2px 6px}pre{padding:12px;overflow:auto}table{border-collapse:collapse;width:100%}td{border-bottom:1px solid #ddd;padding:8px;vertical-align:top}</style></head><body>
<h1>Cash Flow 13 API</h1><p>${esc(SPEC.info.description)}</p>
<h2>Example</h2><pre>curl -H "Authorization: Bearer cf13k_YOUR_KEY" https://YOUR-HOST/api/plans</pre>
<h2>Endpoints</h2><table>${rows}</table>
<h2>Errors</h2><p>Every error is JSON: <code>{"ok":false,"error":"code"}</code>. 429 carries a <code>Retry-After</code> header.</p>
<p><a href="/api/openapi.json">OpenAPI 3 specification (JSON)</a></p></body></html>`);
  }
}
