import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/agent/route';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const request = () => new Request('http://localhost/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { productName: 'Кабель', recommendedQuantity: 50 } }) });
describe('Explanation transport states', () => {
  it('labels a local explanation as demo without contacting a model', async () => {
    vi.stubEnv('OPENAI_API_KEY', ''); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const response = await POST(request());
    expect(response.status).toBe(200); expect((await response.json()).mode).toBe('demo'); expect(fetch).not.toHaveBeenCalled();
  });
  it('returns a visible failure instead of relabeling an upstream failure as a successful explanation', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    const response = await POST(request()); expect(response.status).toBe(502); expect(await response.json()).toHaveProperty('error');
  });
  it('does not label a fallback as AI when the service returns no text', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-only-key'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ output: [] })));
    expect((await POST(request())).status).toBe(502);
  });
  it('rejects malformed JSON with a useful client response', async () => {
    const response = await POST(new Request('http://localhost/api/agent', { method: 'POST', body: '{' })); expect(response.status).toBe(400);
  });
});
