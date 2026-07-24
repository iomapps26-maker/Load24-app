// Mirrors the `consent_type` check constraint on public.consents
// (db/migrations/003_add_roles_devices_consents.sql).
export const CONSENT_TYPES = ['terms_of_service', 'privacy_policy', 'marketing_sms', 'marketing_email'];

// Consents a user must have granted, at this exact version, before they can
// use anything outside the onboarding flow. Bumping a version here means
// existing users are re-prompted next time requireConsents runs.
export const REQUIRED_CONSENTS = [
  { consent_type: 'terms_of_service', version: '1.0' },
  { consent_type: 'privacy_policy', version: '1.0' }
];

// Shared by requireConsents (blocks non-onboarding routes) and
// GET /api/auth/consents/status (lets the app check proactively, before
// hitting a blocked route, whether it needs to show the terms screen).
export function missingRequiredConsents(grantedRows) {
  const granted = new Set((grantedRows || []).map((row) => `${row.consent_type}@${row.version}`));
  return REQUIRED_CONSENTS.filter((c) => !granted.has(`${c.consent_type}@${c.version}`));
}
