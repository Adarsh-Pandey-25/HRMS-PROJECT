/**
 * The test and demo seed scripts write made-up people and data, and
 * seed-test-data.js deletes every employee it didn't create, in every
 * company. Developers' .env files point at the production database (audit,
 * 20 Nov 2026), so these scripts refuse to run unless you say, on purpose,
 * which database they may touch:
 *
 *   SEED_TARGET_PROJECT=<project ref> node scripts/seed-test-data.js
 *
 * where <project ref> is the part before ".supabase.co" in SUPABASE_URL, and
 * never with NODE_ENV=production. Call it right after dotenv loads, before
 * anything connects.
 */
const projectRefOf = (url) => {
  const match = String(url || '').match(/^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in)/i);
  return match ? match[1].toLowerCase() : String(url || '').trim().toLowerCase();
};

module.exports = function refuseUnlessTestDatabase(scriptName) {
  const target = String(process.env.SEED_TARGET_PROJECT || '').trim().toLowerCase();
  const actual = projectRefOf(process.env.SUPABASE_URL);
  const reasons = [];
  if (process.env.NODE_ENV === 'production') reasons.push('NODE_ENV is production');
  if (!target) reasons.push('SEED_TARGET_PROJECT is not set');
  else if (target !== actual) reasons.push('SEED_TARGET_PROJECT does not match the database in SUPABASE_URL');
  if (reasons.length) {
    // eslint-disable-next-line no-console
    console.error(`\n✖ ${scriptName} did not run: ${reasons.join('; ')}.\n  It writes test data (and seed-test-data.js deletes employees) — never run it on the live database.\n  To run it on a test database: SEED_TARGET_PROJECT=<its project ref> node scripts/${scriptName}\n`);
    process.exit(1);
  }
};

module.exports.projectRefOf = projectRefOf;
