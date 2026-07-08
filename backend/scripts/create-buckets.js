require('dotenv').config();
const { supabaseAdmin } = require('../src/config/supabase');

const BUCKETS = [
  'documents',
  'receipts',
  'training-materials',
  'profile-pictures',
  'payslips',
];

const createBuckets = async () => {
  const { data: existing, error: listError } = await supabaseAdmin.storage.listBuckets();
  if (listError) {
    console.error('Failed to list buckets:', listError.message);
    process.exit(1);
  }

  const existingNames = new Set((existing || []).map((b) => b.name));

  for (const name of BUCKETS) {
    if (existingNames.has(name)) {
      console.log(`Bucket exists: ${name}`);
      continue;
    }

    const { data, error } = await supabaseAdmin.storage.createBucket(name, {
      public: false,
      fileSizeLimit: 5242880,
    });

    if (error) {
      console.error(`Failed to create ${name}:`, error.message);
    } else {
      console.log(`Created bucket: ${name}`);
    }
  }

  console.log('Storage buckets setup complete.');
};

createBuckets();
