import { act, renderHook, waitFor } from '@testing-library/react-native';
import {
  fetchAuditLog,
  fetchPendingDoctors,
  type AuditLogEntry,
  type PendingDoctor,
} from '@/lib/admin';
import { AUDIT_PAGE_SIZE, useAuditLog } from '../useAuditLog';
import { PENDING_DOCTORS_PAGE_SIZE, usePendingDoctors } from '../usePendingDoctors';
import { ApiError } from '@/lib/errors';

/**
 * Admin list hooks follow the patients-list law: page-1 refetch on filter
 * change, loadMore appends deduped by id, refresh resets to page 1, stale
 * rows never leak between filters.
 */

jest.mock('@/lib/admin', () => ({
  fetchPendingDoctors: jest.fn(),
  fetchAuditLog: jest.fn(),
}));

const mockedPending = fetchPendingDoctors as jest.Mock;
const mockedAudit = fetchAuditLog as jest.Mock;

function pendingDoctor(id: string): PendingDoctor {
  return {
    id,
    phone: `+9198765432${id.slice(-2)}`,
    name: `Dr. ${id}`,
    verificationStatus: 'PENDING',
    createdAt: '2026-08-28T10:00:00.000Z',
    doctorProfile: null,
  };
}

function auditEntry(id: string, action = 'DOCTOR_VERIFIED'): AuditLogEntry {
  return {
    id,
    actorId: 'actor-1',
    actor: { id: 'actor-1', name: 'Root Admin', role: 'SUPER_ADMIN' },
    action,
    target: `user:${id}`,
    detail: null,
    createdAt: '2026-08-30T09:00:00.000Z',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// usePendingDoctors
// ---------------------------------------------------------------------------

describe('usePendingDoctors', () => {
  test('loads page 1 oldest-first and exposes total for the header counter', async () => {
    mockedPending.mockResolvedValue({
      items: [pendingDoctor('u1'), pendingDoctor('u2')],
      total: 31,
      page: 1,
      limit: PENDING_DOCTORS_PAGE_SIZE,
    });

    const { result } = await renderHook(() => usePendingDoctors());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedPending).toHaveBeenCalledWith(1, PENDING_DOCTORS_PAGE_SIZE);
    expect(result.current.items).toHaveLength(2);
    expect(result.current.total).toBe(31);
    expect(result.current.complete).toBe(false);
  });

  test('loadMore appends page 2 deduped by user id (row vanished between pages)', async () => {
    mockedPending.mockResolvedValueOnce({
      items: [pendingDoctor('u1'), pendingDoctor('u2')],
      total: 3,
      page: 1,
      limit: PENDING_DOCTORS_PAGE_SIZE,
    });
    mockedPending.mockResolvedValueOnce({
      // u1 was verified by another admin mid-scroll — page 2 returns u1 + u3.
      items: [pendingDoctor('u1'), pendingDoctor('u3')],
      total: 2,
      page: 2,
      limit: PENDING_DOCTORS_PAGE_SIZE,
    });

    const { result } = await renderHook(() => usePendingDoctors());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockedPending).toHaveBeenLastCalledWith(2, PENDING_DOCTORS_PAGE_SIZE);
    expect(result.current.items.map((d) => d.id)).toEqual(['u1', 'u2', 'u3']);
    expect(result.current.complete).toBe(true);
  });

  test('refresh (post-verify refetch) resets to page 1 and drops handled rows', async () => {
    mockedPending.mockResolvedValueOnce({
      items: [pendingDoctor('u1'), pendingDoctor('u2')],
      total: 2,
      page: 1,
      limit: PENDING_DOCTORS_PAGE_SIZE,
    });
    mockedPending.mockResolvedValueOnce({
      items: [pendingDoctor('u2')],
      total: 1,
      page: 1,
      limit: PENDING_DOCTORS_PAGE_SIZE,
    });

    const { result } = await renderHook(() => usePendingDoctors());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.items.map((d) => d.id)).toEqual(['u2']);
    expect(result.current.total).toBe(1);
  });

  test('a failing load surfaces the friendly error with a retry', async () => {
    mockedPending.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Unexpected failure'));

    const { result } = await renderHook(() => usePendingDoctors());

    await waitFor(() =>
      expect(result.current.error).toBe('Something went wrong. Please try again.'),
    );
    expect(result.current.items).toHaveLength(0);

    mockedPending.mockResolvedValue({
      items: [pendingDoctor('u9')],
      total: 1,
      page: 1,
      limit: PENDING_DOCTORS_PAGE_SIZE,
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// useAuditLog
// ---------------------------------------------------------------------------

describe('useAuditLog', () => {
  test('unfiltered page-1 fetch sends no action/userId', async () => {
    mockedAudit.mockResolvedValue({
      items: [auditEntry('a1')],
      total: 1,
      page: 1,
      limit: AUDIT_PAGE_SIZE,
    });

    const { result } = await renderHook(() => useAuditLog(null, ''));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedAudit).toHaveBeenCalledWith(1, AUDIT_PAGE_SIZE, {});
    expect(result.current.items).toHaveLength(1);
  });

  test('changing the action chip refetches page 1 with the filter; stale rows never leak', async () => {
    mockedAudit.mockResolvedValue({
      items: [auditEntry('a1', 'DOCTOR_VERIFIED')],
      total: 1,
      page: 1,
      limit: AUDIT_PAGE_SIZE,
    });

    const { result, rerender } = await renderHook(
      ({ action }: { action: string | null }) => useAuditLog(action, ''),
      { initialProps: { action: null as string | null } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockedAudit.mockResolvedValue({
      items: [auditEntry('a2', 'APPOINTMENT_CANCELLED')],
      total: 1,
      page: 1,
      limit: AUDIT_PAGE_SIZE,
    });
    await act(async () => {
      rerender({ action: 'APPOINTMENT_CANCELLED' });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedAudit).toHaveBeenLastCalledWith(1, AUDIT_PAGE_SIZE, {
      action: 'APPOINTMENT_CANCELLED',
    });
    expect(result.current.items.map((e) => e.id)).toEqual(['a2']);
  });

  test('userId text is debounced (350ms) and sent as an exact filter', async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    mockedAudit.mockResolvedValue({ items: [], total: 0, page: 1, limit: AUDIT_PAGE_SIZE });

    const { result: debounced, rerender } = await renderHook(
      ({ uid }: { uid: string }) => useAuditLog(null, uid),
      { initialProps: { uid: '' } },
    );
    await act(async () => {});
    expect(mockedAudit).toHaveBeenCalledTimes(1);
    expect(debounced.current.loading).toBe(false);

    await act(async () => {
      rerender({ uid: 'user-act' });
      jest.advanceTimersByTime(100);
    });
    expect(mockedAudit).toHaveBeenCalledTimes(1); // still debouncing

    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    await waitFor(() => expect(mockedAudit).toHaveBeenCalledTimes(2));
    expect(mockedAudit).toHaveBeenLastCalledWith(1, AUDIT_PAGE_SIZE, { userId: 'user-act' });

    jest.useRealTimers();
  });

  test('loadMore appends page 2 deduped by id', async () => {
    mockedAudit.mockResolvedValueOnce({
      items: [auditEntry('a1'), auditEntry('a2')],
      total: 3,
      page: 1,
      limit: AUDIT_PAGE_SIZE,
    });
    mockedAudit.mockResolvedValueOnce({
      items: [auditEntry('a2'), auditEntry('a3')], // a2 re-delivered
      total: 3,
      page: 2,
      limit: AUDIT_PAGE_SIZE,
    });

    const { result } = await renderHook(() => useAuditLog('DOCTOR_VERIFIED', ''));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockedAudit).toHaveBeenLastCalledWith(2, AUDIT_PAGE_SIZE, {
      action: 'DOCTOR_VERIFIED',
    });
    expect(result.current.items.map((e) => e.id)).toEqual(['a1', 'a2', 'a3']);
    expect(result.current.complete).toBe(true);
  });
});
