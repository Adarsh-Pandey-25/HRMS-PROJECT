const { createClient } = require('@supabase/supabase-js');
const config = require('./database');

let supabaseAdminClient = null;
let supabaseAnonClient = null;

const isValidUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

const getSupabaseAdmin = () => {
  if (!supabaseAdminClient) {
    if (!isValidUrl(process.env.SUPABASE_URL) || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
    }
    supabaseAdminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return supabaseAdminClient;
};

const getSupabaseAnon = () => {
  if (!supabaseAnonClient) {
    if (!isValidUrl(process.env.SUPABASE_URL) || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env');
    }
    supabaseAnonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  }
  return supabaseAnonClient;
};

const supabaseAdmin = new Proxy({}, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

const supabaseAnon = new Proxy({}, {
  get(_target, prop) {
    const client = getSupabaseAnon();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

module.exports = { supabaseAdmin, supabaseAnon, getSupabaseAdmin, getSupabaseAnon, config };
