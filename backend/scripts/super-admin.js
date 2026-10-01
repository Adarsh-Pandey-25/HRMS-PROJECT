#!/usr/bin/env node
/**
 * Manage platform super admins from the server's command line — no .env
 * entry needed. Super admins live in the super_admins table; this is how the
 * very first one is created, and the way back in if a password is lost.
 * Every later super admin can be added from Super Admin → Admin Users.
 *
 *   npm run super-admin                                  create one (asks for everything)
 *   npm run super-admin -- --email you@co.com --name "Your Name"
 *   npm run super-admin -- --email you@co.com --reset    set a new password (forgot password)
 *   npm run super-admin -- --email you@co.com --reset --disable-2fa
 *   npm run super-admin -- --list
 *
 * The password is always typed at a hidden prompt — never passed as an
 * argument, so it never lands in shell history. Add --generate to have a
 * strong one generated and shown once instead.
 */
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');
const { supabaseAdmin } = require('../src/config/supabase');

const ROLES = ['full_admin', 'billing_admin', 'support_admin'];
const MIN_LENGTH = 12;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const fail = (message) => { console.error(`\n✖ ${message}\n`); process.exit(1); };

// Non-interactive input (piped) is read line by line, for automation.
let pipedLines = null;
const readPipedLine = async () => {
  if (!pipedLines) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    pipedLines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
  }
  return pipedLines.shift() ?? '';
};

const ask = async (question) => {
  if (!process.stdin.isTTY) { process.stdout.write(question); const v = await readPipedLine(); process.stdout.write('\n'); return v.trim(); }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return answer.trim();
};

const askHidden = async (question) => {
  if (!process.stdin.isTTY) { process.stdout.write(question); const v = await readPipedLine(); process.stdout.write('\n'); return v; }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const { stdin } = process;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); } // Ctrl+C
        if (ch === '\u007f' || ch === '\b') { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
};

const passwordProblem = (pw) => {
  if (pw.length < MIN_LENGTH) return `must be at least ${MIN_LENGTH} characters`;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'must contain letters and numbers';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'must contain a special character (e.g. ! @ #)';
  return null;
};

const getPassword = async () => {
  if (flag('generate')) {
    const generated = `${crypto.randomBytes(15).toString('base64url')}!7a`;
    return { password: generated, generated: true };
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const pw = await askHidden('Password (hidden): ');
    const problem = passwordProblem(pw);
    if (problem) { console.log(`  Password ${problem}.`); continue; }
    const again = await askHidden('Repeat password:   ');
    if (again !== pw) { console.log('  The two passwords do not match.'); continue; }
    return { password: pw, generated: false };
  }
  return fail('No valid password entered.');
};

const list = async () => {
  const { data, error } = await supabaseAdmin
    .from('super_admins')
    .select('email, name, role, is_active, two_factor_enabled, last_login_at')
    .order('created_at', { ascending: true });
  if (error) fail(`Could not read super admins: ${error.message}`);
  if (!data.length) { console.log('\nNo super admins yet. Create one with: npm run super-admin\n'); return; }
  console.log('');
  for (const a of data) {
    console.log(`  ${a.is_active ? '●' : '○'} ${a.email}  ${a.name ? `(${a.name}) ` : ''}— ${a.role || 'full_admin'}${a.two_factor_enabled ? ', 2FA on' : ''}${a.is_active ? '' : ', DISABLED'}`);
  }
  console.log('');
};

const main = async () => {
  if (!process.env.SUPABASE_URL) fail('Run this inside the backend folder, where .env holds the database connection (SUPABASE_URL).');
  if (flag('list')) return list();

  const reset = flag('reset');
  const email = (option('email') || await ask('Super admin email: ')).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('That is not a valid email address.');

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('super_admins').select('id, email, name, role, two_factor_enabled').eq('email', email).maybeSingle();
  if (lookupError) fail(`Could not read super admins: ${lookupError.message}. Is the super_admins table migrated?`);

  if (reset) {
    if (!existing) fail(`No super admin with email ${email}. Run without --reset to create one.`);
    const { password, generated } = await getPassword();
    const update = {
      password_hash: await bcrypt.hash(password, 10),
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    if (flag('disable-2fa')) Object.assign(update, { two_factor_enabled: false, two_factor_secret: null, two_factor_pending_secret: null });
    const { error } = await supabaseAdmin.from('super_admins').update(update).eq('id', existing.id);
    if (error) fail(`Could not update: ${error.message}`);
    // Sign out every existing session for this account.
    await supabaseAdmin.from('super_admin_refresh_tokens').delete().eq('super_admin_id', existing.id);
    console.log(`\n✔ Password reset for ${email}.${flag('disable-2fa') ? ' 2FA turned off — turn it back on after signing in.' : ''} Other sessions were signed out.`);
    if (generated) console.log(`  New password (shown once): ${password}`);
    console.log('');
    return undefined;
  }

  if (existing) fail(`${email} is already a super admin. To set a new password: npm run super-admin -- --email ${email} --reset`);
  const name = option('name') || await ask('Name (optional): ');
  const role = option('role') || 'full_admin';
  if (!ROLES.includes(role)) fail(`Role must be one of: ${ROLES.join(', ')}`);
  const { password, generated } = await getPassword();

  const { error } = await supabaseAdmin.from('super_admins').insert({
    email,
    name: name || null,
    role,
    password_hash: await bcrypt.hash(password, 10),
    is_active: true,
  });
  if (error) fail(`Could not create the super admin: ${error.message}`);
  console.log(`\n✔ Super admin created: ${email} (${role}).`);
  if (generated) console.log(`  Password (shown once — copy it now): ${password}`);
  console.log('  Sign in at https://<your domain>/super-admin/login, then turn on 2FA.\n');
  return undefined;
};

main().then(() => process.exit(0)).catch((err) => fail(err.message));
