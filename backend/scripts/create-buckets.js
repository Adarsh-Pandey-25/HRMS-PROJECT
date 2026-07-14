require('dotenv').config();
const { supabaseAdmin } = require('../src/config/supabase');

const MB = 1024 * 1024;
const BUCKET_LIMITS = {
  documents: 10 * MB,
  receipts: 10 * MB,
  'training-materials': 50 * MB, // Supabase Free max; set TRAINING_VIDEO_MAX_MB + upgrade Pro for larger
  'course-videos': 50 * MB,
  'profile-pictures': 5 * MB,
  payslips: 10 * MB,
};

const createBuckets = async () => {
  const { data: existing, error: listError } = await supabaseAdmin.storage.listBuckets();
  if (listError) {
    console.error('Failed to list buckets:', listError.message);
    process.exit(1);
  }

  const existingNames = new Set((existing || []).map((b) => b.name));

  for (const [name, fileSizeLimit] of Object.entries(BUCKET_LIMITS)) {
    if (existingNames.has(name)) {
      const { error } = await supabaseAdmin.storage.updateBucket(name, {
        public: false,
        fileSizeLimit,
      });
      if (error) {
        console.error(`Failed to update ${name}:`, error.message);
      } else {
        console.log(`Updated ${name} limit to ${Math.round(fileSizeLimit / MB)} MB`);
      }
      continue;
    }

    const { error } = await supabaseAdmin.storage.createBucket(name, {
      public: false,
      fileSizeLimit,
    });

    if (error) {
      console.error(`Failed to create ${name}:`, error.message);
    } else {
      console.log(`Created bucket: ${name} (${Math.round(fileSizeLimit / MB)} MB limit)`);
    }
  }

  console.log('Storage buckets setup complete.');
};

createBuckets();
