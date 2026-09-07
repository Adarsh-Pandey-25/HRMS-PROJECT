const { createClient } = require('@supabase/supabase-js');
const config = require('./database');

let supabaseAdminClient = null;

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

const supabaseAdmin = new Proxy({}, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

module.exports = { supabaseAdmin, getSupabaseAdmin, config };
