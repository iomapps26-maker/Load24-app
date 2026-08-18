import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requireAuth } from './middleware/auth.js';
import { requireConsents } from './middleware/requireConsents.js';
import { requireRole } from './middleware/requireRole.js';
import { apiRateLimiter } from './middleware/rateLimit.js';
import profileRouter from './routes/profile.js';
import kycRouter from './routes/kyc.js';
import loadsRouter from './routes/loads.js';
import loadLikesRouter from './routes/loadLikes.js';
import loadBidsRouter from './routes/loadBids.js';
import onboardingRouter from './routes/onboarding.js';
import authRouter from './routes/auth.js';
import whatsappAuthRouter from './routes/whatsappAuth.js';
import bankDetailsRouter from './routes/bankDetails.js';
import trucksRouter from './routes/trucks.js';
import truckAvailabilityRouter from './routes/truckAvailability.js';
import reviewsRouter from './routes/reviews.js';
import supportTicketsRouter from './routes/supportTickets.js';
import walletRouter, { razorpayWebhookHandler } from './routes/wallet.js';
import notificationsRouter from './routes/notifications.js';
import adminDashboardRouter from './routes/admin/dashboard.js';
import adminUsersRouter from './routes/admin/users.js';
import adminSupportTicketsRouter from './routes/admin/supportTickets.js';
import adminModerationRouter from './routes/admin/moderation.js';
import adminTripsRouter from './routes/admin/trips.js';
import adminNotificationTemplatesRouter from './routes/admin/notificationTemplates.js';
import adminNotificationsRouter from './routes/admin/notifications.js';
import adminCommissionRulesRouter from './routes/admin/commissionRules.js';
import adminRiskRouter from './routes/admin/risk.js';
import adminHierarchyRouter from './routes/admin/hierarchy.js';
import adminCrmRouter from './routes/admin/crm.js';
import adminIncentivesRouter from './routes/admin/incentives.js';
import tripLocationPingsRouter from './routes/tripLocationPings.js';
import { generateMatchSuggestions } from './lib/matchSuggestions.js';
import { evaluateIncentiveRules } from './lib/incentiveEvaluation.js';

// Staff roles for the whole /api/admin/* namespace below — matches
// kyc.js's/trucks.js's STAFF_ROLES (not wallet.js's, which also includes
// accounts_executive/accounts_manager for withdrawal payouts specifically;
// dashboard/user-management/support-ticket triage aren't an accounts
// concern).
const ADMIN_STAFF_ROLES = ['admin', 'support_executive', 'support_manager'];
// crm.js's own role set — CRM leads are a sales concern, not the general
// admin/support one above.
const CRM_STAFF_ROLES = ['admin', 'sales_executive', 'sales_team_lead', 'sales_manager'];

const app = express();
app.use(cors());
// The `verify` hook stashes the raw request bytes on req.rawBody, which the
// Razorpay webhook handler needs for HMAC signature verification — deriving
// it from the already-parsed req.body wouldn't reproduce the exact bytes
// Razorpay signed.
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api', apiRateLimiter);

// WhatsApp OTP login is the login step itself, so it runs with no session at
// all — mounted at the more specific /api/auth/whatsapp path *before* the
// requireAuth-gated /api/auth block below so it never hits that middleware.
app.use('/api/auth/whatsapp', whatsappAuthRouter);

// Same reasoning as WhatsApp OTP above: Razorpay calls this directly with no
// user session, authenticated only by its HMAC signature.
app.post('/api/wallet/razorpay-webhook', razorpayWebhookHandler);

// Onboarding-safe routes: reachable with just a valid session, before the
// user has recorded the consents requireConsents checks for below. Profile
// setup and terms acceptance necessarily have to happen pre-consent.
app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/profile/kyc', requireAuth, kycRouter);
app.use('/api/onboarding', requireAuth, onboardingRouter);
app.use('/api/auth', requireAuth, authRouter);

// Everything else requires REQUIRED_CONSENTS (see src/lib/consents.js) to
// have been recorded via POST /api/auth/accept-terms first.
app.use('/api/loads', requireAuth, requireConsents, loadsRouter);
app.use('/api/load-likes', requireAuth, requireConsents, loadLikesRouter);
app.use('/api/load-bids', requireAuth, requireConsents, loadBidsRouter);
app.use('/api/bank-details', requireAuth, requireConsents, bankDetailsRouter);
app.use('/api/trucks', requireAuth, requireConsents, trucksRouter);
app.use('/api/truck-availability', requireAuth, requireConsents, truckAvailabilityRouter);
app.use('/api/reviews', requireAuth, requireConsents, reviewsRouter);
app.use('/api/support-tickets', requireAuth, requireConsents, supportTicketsRouter);
app.use('/api/wallet', requireAuth, requireConsents, walletRouter);
app.use('/api/notifications', requireAuth, requireConsents, notificationsRouter);

// The mobile app posts here repeatedly during an active trip. requireAuth
// only, deliberately — not requireConsents (a party already has an active
// matched/in_transit trip by the time this is ever called, which itself
// required consents to reach) and obviously not admin-gated. Authorization
// (caller must be a party to the specific trip) is enforced in the route
// itself — see routes/tripLocationPings.js for why that can't be RLS.
app.use('/api/trip-location-pings', requireAuth, tripLocationPingsRouter);

// /api/admin/* — role-checked once at the router level, unlike kyc.js's/
// wallet.js's per-route requireRole(STAFF_ROLES) calls, since every route
// in these files is staff-only with no user-facing counterpart to carve out
// (no requireConsents either — staff accounts have no reason to have
// accepted the shipper/driver terms flow).
app.use('/api/admin/dashboard', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminDashboardRouter);
app.use('/api/admin/users', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminUsersRouter);
app.use('/api/admin/support-tickets', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminSupportTicketsRouter);
app.use('/api/admin/moderation', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminModerationRouter);
app.use('/api/admin/trips', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminTripsRouter);
app.use('/api/admin/notification-templates', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminNotificationTemplatesRouter);
app.use('/api/admin/notifications', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminNotificationsRouter);
app.use('/api/admin/commission-rules', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminCommissionRulesRouter);
app.use('/api/admin/risk', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminRiskRouter);
app.use('/api/admin/hierarchy', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminHierarchyRouter);
app.use('/api/admin/crm', requireAuth, requireRole(CRM_STAFF_ROLES), adminCrmRouter);
app.use('/api/admin/incentives', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminIncentivesRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`LOAD24 API listening on :${port}`));

// Render's free tier spins the service down after ~15 min with no inbound
// HTTP traffic. A self-ping only counts as "inbound" if it hits the public
// URL (RENDER_EXTERNAL_URL, set automatically by Render) rather than
// localhost, so this only runs when that var is present — i.e. never locally.
const selfPingUrl = process.env.RENDER_EXTERNAL_URL;
if (selfPingUrl) {
  setInterval(() => {
    fetch(`${selfPingUrl}/health`).catch(() => {});
  }, 10 * 60 * 1000);
}

// "Simple scheduled job" per crm.js's spec: an in-process setInterval, same
// mechanism as the self-ping above, rather than standing up separate
// scheduler infrastructure (no cron/queue exists anywhere in this repo).
// Runs once at startup so suggestions aren't empty for the first hour, then
// hourly — POST /api/admin/crm/generate (crm.js) runs the same function on
// demand. Known limitation of the in-process approach: if this service is
// ever scaled to multiple instances, each would run this redundantly (the
// upsert makes that harmless, just wasteful) — fine at this project's
// current single-instance scale, not fine to leave unexamined if that changes.
generateMatchSuggestions().catch((err) => console.error('[crm] generateMatchSuggestions failed (startup run)', err));
setInterval(() => {
  generateMatchSuggestions().catch((err) => console.error('[crm] generateMatchSuggestions failed', err));
}, 60 * 60 * 1000);

// Same in-process-interval mechanism as generateMatchSuggestions above, but
// deliberately no startup run: this one moves real money
// (evaluateIncentiveRules pays out via applyWalletAdjustment), and while
// its de-dup check (lib/incentiveEvaluation.js's payoutNotes) makes running
// it redundantly harmless, "every deploy immediately triggers a payout
// evaluation pass" isn't a surprise worth risking for a job that isn't
// time-sensitive — trips_completed is a lifetime milestone, not something
// that needs checking within seconds of a threshold being crossed. Every 6
// hours; POST /api/admin/incentives/evaluate (incentives.js) runs it
// on demand.
setInterval(() => {
  evaluateIncentiveRules().catch((err) => console.error('[incentives] evaluateIncentiveRules failed', err));
}, 6 * 60 * 60 * 1000);
