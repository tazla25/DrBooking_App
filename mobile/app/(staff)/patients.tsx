import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import {
  Avatar,
  EmptyState,
  ErrorBanner,
  GlassButton,
  GlassCard,
  GlassHeader,
  GlassScreen,
  GlassTextField,
  StatusChip,
  type AppointmentStatus,
} from '@/components';
import { formatDateISO } from '@/lib/format';
import type { PatientSummary } from '@/lib/staff';
import { usePatients } from '@/hooks/usePatients';
import { colors, spacing, typography } from '@/theme';

/**
 * Staff console — Patients tab: the scoped doctor's patient book (grouped by
 * phone server-side), debounced search over name/phone, paginated. Tapping a
 * row opens the shared notes screen for that phone (the phone is encoded in
 * the URL — phones contain '+').
 */
export default function StaffPatientsScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const list = usePatients(query);

  const openPatient = (patient: PatientSummary) => {
    router.push({
      pathname: '/(staff)/patient/[phone]',
      params: { phone: patient.phone, name: patient.name },
    });
  };

  return (
    <GlassScreen>
      <GlassHeader title="Patients" back={false} />
      <View style={styles.body}>
        <GlassTextField
          icon="search-outline"
          placeholder="Search by name or phone"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
        />

        {list.loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.ctaGradient.end} />
          </View>
        ) : list.error ? (
          <GlassCard padded style={styles.card}>
            <ErrorBanner message={list.error} />
            <GlassButton
              label="Try again"
              icon="refresh-outline"
              onPress={() => void list.refresh()}
            />
          </GlassCard>
        ) : (
          <FlatList
            data={list.items}
            keyExtractor={(item) => item.phone}
            refreshing={list.refreshing}
            onRefresh={() => void list.refresh()}
            onEndReached={() => void list.loadMore()}
            onEndReachedThreshold={0.4}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <EmptyState
                icon="people-outline"
                title={query.trim() ? 'No matching patients' : 'No patients yet'}
                caption={
                  query.trim()
                    ? 'Nothing matches that name or phone. Try a shorter search.'
                    : 'Patients appear here once they book with this practice.'
                }
              />
            }
            ListFooterComponent={
              list.loadingMore ? (
                <View style={styles.footer}>
                  <ActivityIndicator color={colors.ctaGradient.end} />
                </View>
              ) : list.complete && list.items.length > 0 ? (
                <Text style={styles.footerHint}>
                  {list.total} patient{list.total === 1 ? '' : 's'} · all loaded
                </Text>
              ) : null
            }
            renderItem={({ item }) => (
              <PatientRow patient={item} onOpen={() => openPatient(item)} />
            )}
          />
        )}
      </View>
    </GlassScreen>
  );
}

function PatientRow({ patient, onOpen }: { patient: PatientSummary; onOpen: () => void }) {
  return (
    <GlassCard padded style={styles.card}>
      <View style={styles.row}>
        <Avatar name={patient.name} size={44} />
        <View style={styles.identity}>
          <Text style={styles.name} numberOfLines={1}>
            {patient.name}
          </Text>
          <Text style={styles.phone}>{patient.phone}</Text>
        </View>
        <StatusChip status={patient.lastStatus as AppointmentStatus} />
      </View>
      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={13} color={colors.text.secondary} />
        <Text style={styles.metaText}>Last visit {formatDateISO(patient.lastVisit)}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>
          {patient.totalVisits} visit{patient.totalVisits === 1 ? '' : 's'}
        </Text>
        <GlassButton
          label="Notes"
          icon="document-text-outline"
          onPress={onOpen}
          style={styles.notesBtn}
        />
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.base, gap: spacing.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { gap: spacing.md },
  listContent: { paddingBottom: spacing.xxxl, gap: spacing.base },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identity: { flex: 1, gap: spacing.xs },
  name: { ...typography.bodySemi, color: colors.text.primary, flexShrink: 1 },
  phone: { ...typography.caption, color: colors.text.secondary },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  metaText: { ...typography.caption, color: colors.text.secondary },
  metaDot: { ...typography.caption, color: colors.text.secondary },
  notesBtn: { marginLeft: 'auto', minHeight: 36, paddingHorizontal: spacing.lg },
  footer: { paddingVertical: spacing.base },
  footerHint: {
    ...typography.caption,
    color: colors.text.secondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
