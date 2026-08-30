import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Switch, Text, View } from 'react-native';
import {
  Avatar,
  EmptyState,
  ErrorBanner,
  GlassButton,
  GlassCard,
  GlassHeader,
  GlassScreen,
  GlassTextField,
  GlassToast,
  PrimaryButton,
  useToast,
} from '@/components';
import { toFriendlyMessage } from '@/lib/errors';
import { formatDateISO } from '@/lib/format';
import { istDateOfISO } from '@/lib/time';
import { addPatientNote, fetchPatientNotes, type PatientNote } from '@/lib/staff';
import { validateNoteForm } from '@/lib/validation';
import { colors, radii, spacing, typography } from '@/theme';

/**
 * Patient notes (staff-only, shared within the doctor's team — keyed by
 * phone so walk-ins without accounts work too). Newest first, author
 * name + role chip, important notes starred. Add-note form posts and
 * prepends to the list.
 *
 * C2: expo-router ALREADY decodes route params — never decodeURIComponent
 * again here (a patient name containing '%' would throw URIError).
 */
export default function PatientNotesScreen() {
  const params = useLocalSearchParams<{ phone: string; name?: string }>();
  const phone = params.phone ?? '';
  const patientName = params.name ?? null;
  const { toast, show } = useToast();

  const [notes, setNotes] = useState<PatientNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [noteText, setNoteText] = useState('');
  const [important, setImportant] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // State updates happen ONLY in the async callbacks (never synchronously
  // inside the effect body — react-hooks/set-state-in-effect).
  useEffect(() => {
    let alive = true;
    fetchPatientNotes(phone)
      .then((data) => {
        if (!alive) return;
        setNotes(data.notes);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(toFriendlyMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [phone, reloadKey]);

  /** Pull-to-refresh — event handler, may set state freely. */
  const refresh = async () => {
    setRefreshing(true);
    try {
      const data = await fetchPatientNotes(phone);
      setNotes(data.notes);
      setError(null);
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  const submitNote = async () => {
    const validation = validateNoteForm(noteText);
    setNoteError(validation);
    if (validation) return;

    setSubmitting(true);
    setNoteError(null);
    try {
      const { note } = await addPatientNote(phone, noteText, important);
      setNotes((prev) => [note, ...(prev ?? [])]); // newest first
      setNoteText('');
      setImportant(false);
      show('Note added', 'success');
    } catch (err) {
      setNoteError(toFriendlyMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GlassScreen>
      <GlassHeader title="Patient notes" />
      <View style={styles.body}>
        {/* -- patient identity -------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <View style={styles.identityRow}>
            <Avatar name={patientName ?? phone} size={48} />
            <View style={styles.identity}>
              <Text style={styles.name} numberOfLines={1}>
                {patientName ?? 'Patient'}
              </Text>
              <Text style={styles.phone}>{phone}</Text>
            </View>
          </View>
          <Text style={styles.hint}>
            Notes are shared with the whole care team and stay attached to this phone number.
          </Text>
        </GlassCard>

        {/* -- add note ----------------------------------------------------------- */}
        <GlassCard padded style={styles.card}>
          <GlassTextField
            label="New note"
            icon="document-text-outline"
            value={noteText}
            onChangeText={setNoteText}
            error={noteError}
            placeholder="e.g. Allergic to penicillin — flagged on chart"
            multiline
          />
          <View style={styles.importantRow}>
            <Ionicons
              name={important ? 'star' : 'star-outline'}
              size={18}
              color={important ? colors.star : colors.text.secondary}
            />
            <Text style={styles.importantLabel}>Mark as important</Text>
            <Switch
              accessibilityLabel="Mark as important"
              value={important}
              onValueChange={setImportant}
              trackColor={{ true: colors.star, false: colors.unavailable }}
              thumbColor={colors.white}
            />
          </View>
          <PrimaryButton
            label="Add note"
            icon="add-outline"
            loading={submitting}
            disabled={noteText.trim().length === 0}
            onPress={() => void submitNote()}
          />
        </GlassCard>

        {/* -- notes list ---------------------------------------------------------- */}
        {notes === null && !error ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.ctaGradient.end} />
          </View>
        ) : error && notes === null ? (
          <GlassCard padded style={styles.card}>
            <ErrorBanner message={error} />
            <GlassButton
              label="Try again"
              icon="refresh-outline"
              onPress={() => setReloadKey((k) => k + 1)}
            />
          </GlassCard>
        ) : (
          <FlatList
            data={notes ?? []}
            keyExtractor={(item) => item.id}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <EmptyState
                icon="document-text-outline"
                title="No notes yet"
                caption="Add the first note above — it is instantly visible to the whole team."
              />
            }
            renderItem={({ item }) => <NoteRow note={item} />}
          />
        )}
      </View>
      <GlassToast toast={toast} />
    </GlassScreen>
  );
}

function NoteRow({ note }: { note: PatientNote }) {
  return (
    <GlassCard padded style={styles.card}>
      <View style={styles.noteHeader}>
        {note.isImportant ? (
          <View style={styles.importantChip}>
            <Ionicons name="star" size={11} color={colors.star} />
            <Text style={styles.importantChipText}>IMPORTANT</Text>
          </View>
        ) : null}
        <Text style={styles.date}>{formatDateISO(istDateOfISO(note.createdAt))}</Text>
      </View>
      <Text style={styles.noteText}>{note.note}</Text>
      {note.author ? (
        <View style={styles.authorRow}>
          <Ionicons name="person-circle-outline" size={15} color={colors.text.secondary} />
          <Text style={styles.authorName} numberOfLines={1}>
            {note.author.name}
          </Text>
          <View style={styles.roleChip}>
            <Text style={styles.roleChipText}>{roleLabel(note.author.role)}</Text>
          </View>
        </View>
      ) : null}
    </GlassCard>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case 'DOCTOR':
      return 'Doctor';
    case 'COMPOUNDER':
      return 'Compounder';
    case 'SUPER_ADMIN':
      return 'Admin';
    default:
      return role;
  }
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.base, gap: spacing.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { gap: spacing.md },
  listContent: { paddingBottom: spacing.xxxl, gap: spacing.base },

  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identity: { flex: 1, gap: spacing.xs },
  name: { ...typography.h3, color: colors.text.primary },
  phone: { ...typography.caption, color: colors.text.secondary },
  hint: { ...typography.caption, color: colors.text.secondary },

  importantRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  importantLabel: { ...typography.caption, color: colors.text.primary, flex: 1 },

  noteHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  importantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(245, 166, 35, 0.18)',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.35)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  importantChipText: { ...typography.micro, color: '#B27415', letterSpacing: 0.4 },
  date: { ...typography.micro, color: colors.text.secondary, marginLeft: 'auto' },
  noteText: { ...typography.body, color: colors.text.primary },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  authorName: { ...typography.caption, color: colors.text.secondary, flexShrink: 1 },
  roleChip: {
    backgroundColor: colors.glass.nested,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.glass.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  roleChipText: { ...typography.micro, color: colors.text.secondary, letterSpacing: 0.3 },
});
