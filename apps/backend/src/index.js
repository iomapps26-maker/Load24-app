import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { requireAuth } from './middleware/auth.js';
import { requireConsents } from './middleware/requireConsents.js';
import { requireRole } from './middleware/requireRole.js';
import { apiRateLimiter, apiIpBackstopRateLimiter, tripLocationPingRateLimiter } from './middleware/rateLimit.js';
import profileRouter from './routes/profile.js';
import kycRouter from './routes/kyc.js';
import loadsRouter from './routes/loads.js';
import loadLikesRouter from './routes/loadLikes.js';
import loadBidsRouter from './routes/loadBids.js';
import onboardingRouter from './routes/onboarding.js';
import authRouter from './routes/auth.js';
import whatsappAuthRouter from './routes/whatsappAuth.js';
import bankDetailsRouter from './routes/bankDetails.js';
import bankAccountsRouter from './routes/bankAccounts.js';
import trucksRouter from './routes/trucks.js';
import truckAvailabilityRouter from './routes/truckAvailability.js';
import reviewsRouter from './routes/reviews.js';
import supportTicketsRouter from './routes/supportTickets.js';
import walletRouter from './routes/wallet.js';
import notificationsRouter from './routes/notifications.js';
import adminDashboardRouter from './routes/admin/dashboard.js';
import adminUsersRouter from './routes/admin/users.js';
import adminSupportTicketsRouter from './routes/admin/supportTickets.js';
import adminModerationRouter from './routes/admin/moderation.js';
import adminTripsRouter from './routes/admin/trips.js';
import adminBookingsRouter from './routes/admin/bookings.js';
import adminNotificationTemplatesRouter from './routes/admin/notificationTemplates.js';
import adminNotificationsRouter from './routes/admin/notifications.js';
import adminCommissionRulesRouter from './routes/admin/commissionRules.js';
import adminPlatformSettingsRouter from './routes/admin/platformSettings.js';
import adminRiskRouter from './routes/admin/risk.js';
import adminHierarchyRouter from './routes/admin/hierarchy.js';
import adminCrmRouter from './routes/admin/crm.js';
import adminIncentivesRouter from './routes/admin/incentives.js';
import adminContentBlocksRouter, { appVersionsRouter as adminAppVersionsRouter, appConfigHandler } from './routes/admin/content.js';
import adminMasterDataRouter, { publicMasterDataRouter } from './routes/admin/masterData.js';
import adminAuditLogRouter from './routes/admin/auditLog.js';
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

// Behind Render's load balancer: trust the first proxy hop so req.ip resolves
// to the real client address (from X-Forwarded-For) instead of the balancer's.
// Without this every IP-keyed rate limiter shares one bucket across all users
// and the whole API 429s after a few hundred requests total.
app.set('trust proxy', 1);

app.use(compression());
app.use(cors({
  // Native app traffic carries no Origin and is unaffected either way. Set
  // CORS_ALLOWED_ORIGINS (comma-separated) to restrict the browser-based
  // admin site; left unset this reflects the request origin — the previous
  // behaviour — so this is a no-op until the env var is configured.
  origin: process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
    : true
}));
app.use(express.json({ limit: '256kb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

// Android App Links verification for the mobile app's load24:// /
// https://load24.in/loads/:id deep link (WhatsApp's "View Load"/"Bid"
// buttons — see AndroidManifest.xml's autoVerify intent-filter and
// PlaceBidScreen.jsx). Must be served from exactly this path on load24.in
// itself with no redirect — served straight from this backend so it works
// the moment load24.in is pointed at Render as a custom domain, no separate
// static hosting needed. sha256_cert_fingerprints is the upload-key
// certificate (apps/mobile/android/app/load24-upload-key-cert.pem) —
// confirmed identical to Play Console's App signing key certificate (Test
// and release > App integrity), so this one fingerprint covers both what
// gets uploaded and what actually signs installs from the Play Store.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.base699327bbace8d2c0b141d1bc.app',
        sha256_cert_fingerprints: [
          '82:BA:74:57:81:04:68:08:30:8E:FE:AB:77:DB:93:DE:BC:CC:52:D8:C5:FC:48:13:17:FD:E6:16:E3:59:49:65'
        ]
      }
    }
  ]);
});

// Public landing page for https://load24.in/loads/:id when it's reached
// over plain HTTP instead of being intercepted by the Android App Link
// above — i.e. verification hasn't reached this device yet, the visitor is
// on desktop/iOS, or the app isn't installed at all. GET /api/loads/:id
// (routes/loads.js) returns the full row (pricing, party details) behind
// requireAuth, so this route deliberately never fetches or renders any load
// data — it only tries to hand off to the app via the load24:// custom
// scheme (see AndroidManifest.xml's non-autoVerify intent-filter, already
// wired up in App.jsx's extractLoadId) and otherwise points at the Play
// Store. :id is validated as a uuid (matches db/migrations/001_init.sql's
// loads.id column) before being interpolated into the page, since it comes
// straight from the URL.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.base699327bbace8d2c0b141d1bc.app';
app.get('/loads/:id', (req, res) => {
  const loadId = UUID_RE.test(req.params.id) ? req.params.id : null;
  const deepLink = loadId ? `load24://loads/${loadId}` : null;
  res.status(loadId ? 200 : 404).type('html').send(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${loadId ? 'Open in LOAD24' : 'Load not found'}</title>
<style>
  body { font-family: -apple-system, Roboto, Arial, sans-serif; background: #0f172a; color: #f1f5f9; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 24px; text-align: center; }
  .card { max-width: 360px; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  p { color: #94a3b8; font-size: 14px; line-height: 1.5; }
  a.button { display: block; margin-top: 20px; padding: 14px; border-radius: 10px; background: #22c55e; color: #0f172a; font-weight: 600; text-decoration: none; }
  a.secondary { display: block; margin-top: 12px; color: #60a5fa; font-size: 14px; text-decoration: none; }
</style>
</head>
<body>
  <div class="card">
    ${loadId ? `
    <h1>Open this load in the LOAD24 app</h1>
    <p>This link opens directly in the app once it's installed. If nothing happened automatically, use the button below.</p>
    <a class="button" href="${deepLink}">Open in LOAD24</a>
    <a class="secondary" href="${PLAY_STORE_URL}">Don't have the app? Get it on Google Play</a>
    <script>window.location.href = ${JSON.stringify(deepLink)};</script>
    ` : `
    <h1>Load link not found</h1>
    <p>This link looks incomplete or has expired. Open the LOAD24 app to browse current loads.</p>
    <a class="button" href="${PLAY_STORE_URL}">Get LOAD24 on Google Play</a>
    `}
  </div>
</body>
</html>`);
});

// helmet's security headers, scoped to the JSON API only — the public HTML
// pages above (/loads/:id's inline redirect script, the assetlinks file) are
// served from the root and must stay untouched. The cross-origin isolation
// headers (CSP / CORP / COOP / COEP) are turned off deliberately: they carry
// no benefit for a pure JSON API and CORP/COEP in particular would break the
// browser-based admin site's cross-origin calls to /api/admin/*. What stays
// on is the useful, non-breaking set — HSTS, X-Content-Type-Options: nosniff,
// X-Frame-Options, Referrer-Policy, etc.
// Then two rate limiters, coarsest first: a high per-IP backstop against a
// single host flooding the API, then the real per-user budget (rateLimit.js).
app.use(
  '/api',
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false
  }),
  apiIpBackstopRateLimiter,
  apiRateLimiter
);

// WhatsApp OTP login is the login step itself, so it runs with no session at
// all — mounted at the more specific /api/auth/whatsapp path *before* the
// requireAuth-gated /api/auth block below so it never hits that middleware.
app.use('/api/auth/whatsapp', whatsappAuthRouter);

// Public, no auth — both called by the mobile app before/without a session
// (app-config on launch, master-data to populate form dropdowns like truck
// registration) and, for master-data, by the admin site too. See content.js's
// appConfigHandler / masterData.js's publicMasterDataRouter for why these go
// through supabaseAdmin rather than req.supabase.
app.get('/api/app-config', appConfigHandler);
app.use('/api/master-data', publicMasterDataRouter);

// Onboarding-safe routes: reachable with just a valid session, before the
// user has recorded the consents requireConsents checks for below. Profile
// setup and terms acceptance necessarily have to happen pre-consent.
app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/profile/kyc', requireAuth, kycRouter);
// Staff-only payout bank-account review (per-route requireRole, like kyc.js /
// wallet.js). Mounted under /api/profile like kyc so it sits outside
// requireConsents — staff accounts never went through the shipper/driver
// terms flow. profileRouter above only matches /me and / so this falls through.
app.use('/api/profile/bank-accounts', requireAuth, bankAccountsRouter);
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
app.use('/api/trip-location-pings', requireAuth, tripLocationPingRateLimiter, tripLocationPingsRouter);

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
app.use('/api/admin/bookings', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminBookingsRouter);
app.use('/api/admin/notification-templates', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminNotificationTemplatesRouter);
app.use('/api/admin/notifications', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminNotificationsRouter);
app.use('/api/admin/commission-rules', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminCommissionRulesRouter);
app.use('/api/admin/platform-settings', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminPlatformSettingsRouter);
app.use('/api/admin/risk', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminRiskRouter);
app.use('/api/admin/hierarchy', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminHierarchyRouter);
app.use('/api/admin/crm', requireAuth, requireRole(CRM_STAFF_ROLES), adminCrmRouter);
app.use('/api/admin/incentives', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminIncentivesRouter);
app.use('/api/admin/content-blocks', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminContentBlocksRouter);
app.use('/api/admin/app-versions', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminAppVersionsRouter);
app.use('/api/admin/master-data', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminMasterDataRouter);
app.use('/api/admin/audit-log', requireAuth, requireRole(ADMIN_STAFF_ROLES), adminAuditLogRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
const server = app.listen(port, () => console.log(`LOAD24 API listening on :${port}`));

// The API runs as a single instance — a stray unhandled rejection or
// exception must not silently wedge it for every user. Log with context; on
// an uncaughtException (genuinely unknown state) exit so Render restarts a
// clean instance rather than keeping a half-broken one in rotation.
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException', err);
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 10_000).unref();
});

// Render sends SIGTERM on every deploy and scale-down. Stop taking new
// connections and let in-flight requests finish instead of dropping them.
process.on('SIGTERM', () => {
  console.log('[process] SIGTERM — draining connections');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});

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

// In-process scheduled jobs. These run on the same event loop as request
// handling, and on every instance if the service is ever scaled out (the
// upserts/de-dup checks make redundant runs harmless, just wasteful).
//
// Set RUN_INPROCESS_JOBS=false once these are moved to Render Cron Jobs
// (which would hit POST /api/admin/crm/generate and
// POST /api/admin/incentives/evaluate — the same functions, already exposed
// as on-demand endpoints). Then one dedicated schedule runs them instead of
// every web instance.
const runInProcessJobs = process.env.RUN_INPROCESS_JOBS !== 'false';

if (runInProcessJobs) {
  // Runs once at startup so suggestions aren't empty for the first hour, then
  // hourly — POST /api/admin/crm/generate (crm.js) runs the same function on
  // demand.
  generateMatchSuggestions().catch((err) => console.error('[crm] generateMatchSuggestions failed (startup run)', err));
  setInterval(() => {
    generateMatchSuggestions().catch((err) => console.error('[crm] generateMatchSuggestions failed', err));
  }, 60 * 60 * 1000);

  // Deliberately no startup run: this one moves real money
  // (evaluateIncentiveRules pays out via applyWalletAdjustment), and while
  // its de-dup check (lib/incentiveEvaluation.js's payoutNotes) makes running
  // it redundantly harmless, "every deploy immediately triggers a payout
  // evaluation pass" isn't a surprise worth risking for a job that isn't
  // time-sensitive — trips_completed is a lifetime milestone. Every 6 hours;
  // POST /api/admin/incentives/evaluate (incentives.js) runs it on demand.
  setInterval(() => {
    evaluateIncentiveRules().catch((err) => console.error('[incentives] evaluateIncentiveRules failed', err));
  }, 6 * 60 * 60 * 1000);
}
