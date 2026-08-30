import { ok } from '@/lib/errors';
import { istTodayISO, istTimeHM } from '@/lib/time';

export const dynamic = 'force-dynamic';

/** GET / — service status (JSON; this API has no UI pages by design). */
export async function GET(): Promise<Response> {
  return ok({
    service: 'dr-booking-api',
    version: '2.0.0',
    phase: 'foundation',
    todayIST: istTodayISO(),
    timeIST: istTimeHM(),
    docs: 'See README.md at the repository root',
  });
}
