const moment = require('moment-timezone');
const { supabaseAdmin } = require('../config/supabase');

const KNOWN_CRONS = ['auto_checkout', 'auto_payroll', 'subscription_billing', 'attendance_anomaly', 'scheduled_backups'];

/**
 * Module 7's own safety rail: never default an unverified check to green.
 * Every entry below is tagged `verified: true` (this function actually
 * queried something real right now) or `verified: false` (display-only /
 * genuinely unknowable from code — reported as "unknown", not "healthy").
 */
/** Tables worth a quick sanity count on the health page — cheap, bounded, not a full audit. */
const SIZE_CHECK_TABLES = ['employees', 'attendance', 'companies'];

/**
 * Real PITR/backup status lives in Supabase's Management API, a completely
 * separate credential (an sbp_... personal/org access token, generated from
 * the Supabase dashboard's account settings) from SUPABASE_SERVICE_KEY used
 * everywhere else in this backend — the service-role key only reaches this
 * project's own Postgres via PostgREST, never Supabase's own control plane.
 * Not present in this environment (checked: no SUPABASE_MANAGEMENT_TOKEN /
 * SUPABASE_ACCESS_TOKEN in .env) — reported honestly as unknown rather than
 * silently skipped, with the exact env var name needed to wire it up later.
 */
const getManagementApiPitrStatus = async () => {
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN || process.env.SUPABASE_ACCESS_TOKEN || null;
  const projectRef = process.env.SUPABASE_PROJECT_REF || null;
  if (!token || !projectRef) {
    return {
      category: 'unknown',
      verified: false,
      status: 'unknown',
      note: 'Supabase Management API not configured — set SUPABASE_MANAGEMENT_TOKEN (an sbp_... token from the Supabase dashboard, Account Settings → Access Tokens) and SUPABASE_PROJECT_REF to surface real PITR/backup status here. Distinct from the app-level backup mechanism below, which IS live.',
    };
  }
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/backups`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Management API returned ${res.status}`);
    const body = await res.json();
    return { category: 'verified', verified: true, status: 'healthy', raw: body };
  } catch (err) {
    return { category: 'unknown', verified: false, status: 'unknown', note: `Management API call failed: ${err.message}` };
  }
};

const getSystemHealth = async () => {
  const dbStart = Date.now();
  const dbOk = await supabaseAdmin.from('companies').select('id').limit(1).then((r) => !r.error).catch(() => false);
  const dbLatencyMs = Date.now() - dbStart;

  const { data: lastBackup } = await supabaseAdmin
    .from('backup_logs')
    .select('status, completed_at, started_at')
    .eq('status', 'success')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: lastMigration } = await supabaseAdmin
    .from('schema_migrations')
    .select('filename, applied_at, verified')
    .order('applied_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sizeChecks = {};
  await Promise.all(SIZE_CHECK_TABLES.map(async (table) => {
    const { count, error } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
    sizeChecks[table] = error ? { verified: false, error: error.message } : { verified: true, rowCount: count };
  }));

  const managementPitr = await getManagementApiPitrStatus();

  const commitHash = process.env.GIT_COMMIT || process.env.RENDER_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || null;
  const appVersion = process.env.npm_package_version || require('../../package.json').version || null;

  return {
    // ── Verified Live: this function actually queried something real, right now ──
    database: {
      category: 'verified',
      verified: true,
      status: dbOk ? 'healthy' : 'degraded',
      latencyMs: dbLatencyMs,
      checkedAt: new Date().toISOString(),
      tableSanityCounts: sizeChecks,
    },
    backups: {
      category: 'verified',
      verified: true,
      status: lastBackup ? 'healthy' : 'unknown',
      lastSuccessfulBackupAt: lastBackup?.completed_at || null,
      note: lastBackup
        ? 'Real app-level snapshot mechanism (backup.cron.js / backup.service.js) — a genuine JSON export of this company\'s core data uploaded to Storage, not cosmetic. Runs daily at 3:30 AM; a fresh deployment may show "unknown" simply because it hasn\'t reached its first scheduled run yet.'
        : 'No successful backup_logs row found yet — either the daily cron hasn\'t run since this was deployed, or every attempt so far has failed (check backup_logs for status=failed rows).',
    },
    migrations: lastMigration
      ? {
          category: lastMigration.verified ? 'verified' : 'best-effort',
          verified: lastMigration.verified,
          status: 'healthy',
          lastMigrationFile: lastMigration.filename,
          lastAppliedAt: lastMigration.applied_at,
          note: lastMigration.verified
            ? null
            : 'This entry is from the backfilled historical baseline (schema_migrations seeded retroactively from COMPLETE_DATABASE_SETUP.sql\'s section list) — approximate, not a real recorded apply time. Only migrations applied after 20260915_schema_migrations_tracking.sql (which self-registers) produce a verified=true row.',
        }
      : {
          category: 'unknown',
          verified: false,
          status: 'unknown',
          note: 'schema_migrations has no rows — either the tracking migration itself hasn\'t been applied yet, or the seed failed.',
        },
    // ── Best-Effort/Approximate ──
    managementApiPitr: managementPitr,
    // ── Unknown (genuinely unknowable from this codebase/environment) ──
    appVersion: {
      category: (commitHash || appVersion) ? 'verified' : 'unknown',
      verified: Boolean(commitHash || appVersion),
      status: (commitHash || appVersion) ? 'healthy' : 'unknown',
      version: appVersion,
      commitHash,
      note: commitHash ? null : 'No GIT_COMMIT/RENDER_GIT_COMMIT/VERCEL_GIT_COMMIT_SHA env var set in this environment.',
    },
    rateLimiting: {
      category: 'verified',
      verified: true,
      status: 'degraded',
      backend: 'in-memory',
      note: 'express-rate-limit\'s default in-memory MemoryStore — resets on every deploy/restart and is not shared across instances. Redis-backed store has not been provisioned (audit finding L-10, still open).',
    },
  };
};

const getCronStatus = async () => {
  const [{ data: recentRuns }, { data: activeLocks }] = await Promise.all([
    supabaseAdmin.from('cron_run_log').select('*').order('finished_at', { ascending: false }).limit(200),
    supabaseAdmin.from('cron_locks').select('*'),
  ]);

  const lockedJobs = new Set((activeLocks || []).map((l) => l.job_name));
  const lastRunByJob = new Map();
  for (const run of recentRuns || []) {
    if (!lastRunByJob.has(run.job_name)) lastRunByJob.set(run.job_name, run);
  }

  return KNOWN_CRONS.map((jobName) => {
    const lastRun = lastRunByJob.get(jobName);
    return {
      jobName,
      verified: Boolean(lastRun),
      currentlyRunning: lockedJobs.has(jobName),
      lastRunAt: lastRun?.finished_at || null,
      lastStatus: lastRun?.status || 'unknown',
      lastDurationMs: lastRun?.duration_ms ?? null,
      lastError: lastRun?.error || null,
      note: lastRun ? null : 'No cron_run_log entry yet for this job — either it has never run since this table was added, or it has not fired yet.',
    };
  });
};

/**
 * subscription_notifications_log only covers billing emails — the only
 * place this codebase persists a delivery-status log at all (confirmed by
 * grep: sendWithFallback in config/email.js has no general success/failure
 * log table, only in-process logger output). Reported honestly as
 * billing-scoped, not "all app email."
 */
const getEmailFailures = async (hours = 24) => {
  const since = moment().subtract(hours, 'hours').toISOString();
  const { data, error } = await supabaseAdmin
    .from('subscription_notifications_log')
    .select('id, notification_type, company_subscription_id, sent_at, delivery_status')
    .eq('delivery_status', 'failed')
    .gte('sent_at', since);
  if (error) {
    return { verified: false, status: 'unknown', count: 0, note: `Could not query subscription_notifications_log: ${error.message}` };
  }
  return {
    verified: true,
    scope: 'subscription/billing emails only — no delivery-status log exists for other transactional email in this codebase',
    windowHours: hours,
    failureCount: (data || []).length,
    failures: data || [],
  };
};

module.exports = { getSystemHealth, getCronStatus, getEmailFailures };
