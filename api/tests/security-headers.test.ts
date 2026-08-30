import { securityHeaders } from '@/lib/security-headers';
import { proxy } from '@/proxy';
import { NextRequest } from 'next/server';

describe('Security headers (Phase 4 hardening)', () => {
  it('always sets X-Content-Type-Options, X-Frame-Options, Referrer-Policy', () => {
    const headers = securityHeaders(false);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['strict-transport-security']).toBeUndefined(); // dev: no HSTS
  });

  it('adds HSTS only in production', () => {
    const headers = securityHeaders(true);
    expect(headers['strict-transport-security']).toContain('max-age=63072000');
    expect(headers['strict-transport-security']).toContain('includeSubDomains');
  });

  it('proxy applies the headers to a passing response', () => {
    const request = new NextRequest('http://localhost:3000/api/doctors');
    const response = proxy(request);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });
});
