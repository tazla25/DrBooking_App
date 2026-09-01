import * as Haptics from 'expo-haptics';

/**
 * Haptic feedback helpers (Phase 10-c) — expo-haptics is the ONLY new
 * dependency. Every helper is try/catch-safe: if the native module is
 * unavailable (Expo Go variant, engine error, unsupported device) the call
 * becomes a silent no-op and the UI flow continues untouched.
 *
 * Usage law:
 *  - selection changes (chips, tab bar, date strip) → hapticSelection;
 *  - confirmed outcomes (booking success, "your turn", Call/Complete) →
 *    hapticSuccess;
 *  - destructive confirmations (Cancel / No-show / Deactivate) → hapticWarning;
 *  - NEVER on plain scrolls or failed requests.
 */

/** Selection changed — chips, tab bar, date strip (light tick). */
export function hapticSelection(): void {
  try {
    void Haptics.selectionAsync();
  } catch {
    // no-op by design — haptics must never break a flow
  }
}

/** Positive confirmation — booking success, "your turn", Call/Complete. */
export function hapticSuccess(): void {
  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // no-op by design — haptics must never break a flow
  }
}

/** Destructive confirmation — Cancel / No-show / Deactivate. */
export function hapticWarning(): void {
  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  } catch {
    // no-op by design — haptics must never break a flow
  }
}
