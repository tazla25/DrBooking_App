import {
  GET as catchAllGet,
  POST as catchAllPost,
  DELETE as catchAllDelete,
} from '@/app/api/[...slug]/route';
import { GET as apiRootGet } from '@/app/api/route';
import { postRequest, getRequest, readResponse, resetDb, API } from './helpers';

describe('Catch-all 404 envelope (Phase 4 hardening)', () => {
  beforeAll(async () => {
    await resetDb();
  });

  it('unknown GET path → 404 { ok:false, error:{ code:"NOT_FOUND" } }', async () => {
    const res = await catchAllGet(
      getRequest(`${API}/api/totally/unknown/path`),
      { params: Promise.resolve({ slug: ['totally', 'unknown', 'path'] }) },
    );
    const body = await readResponse(res);
    expect(body.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('NOT_FOUND');
    expect(body.error?.message).toContain('totally/unknown/path');
  });

  it('every HTTP method returns the 404 envelope', async () => {
    const ctx = { params: Promise.resolve({ slug: ['nope'] }) };
    for (const handler of [catchAllGet, catchAllPost, catchAllDelete]) {
      const req =
        handler === catchAllGet
          ? getRequest(`${API}/api/nope`)
          : postRequest(`${API}/api/nope`, {});
      const body = await readResponse(await handler(req, ctx));
      expect(body.status).toBe(404);
      expect(body.error?.code).toBe('NOT_FOUND');
    }
  });

  it('unmatched sub-path of an existing resource → 404 envelope', async () => {
    // /api/appointments/<id> has no direct route (only /status and /cancel).
    const res = await catchAllGet(
      getRequest(`${API}/api/appointments/abc123`),
      { params: Promise.resolve({ slug: ['appointments', 'abc123'] }) },
    );
    const body = await readResponse(res);
    expect(body.status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('bare /api → 404 envelope too', async () => {
    const body = await readResponse(await apiRootGet(getRequest(`${API}/api`)));
    expect(body.status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });
});
