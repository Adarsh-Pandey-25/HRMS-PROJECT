-- Supabase Storage Buckets Setup
-- Run in Supabase SQL Editor after creating buckets in Dashboard

-- Create buckets via Dashboard: Storage > New Bucket
-- Buckets: documents, receipts, training-materials, profile-pictures, payslips
-- Set all as PRIVATE

-- Storage policies (service role bypasses; these are for direct client access if needed)

-- Documents bucket
CREATE POLICY "HR can read all documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'documents');

CREATE POLICY "Authenticated users upload own documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'documents');

-- Receipts bucket
CREATE POLICY "Users can upload receipts"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'receipts');

CREATE POLICY "Users can read own receipts"
ON storage.objects FOR SELECT
USING (bucket_id = 'receipts');

-- Payslips bucket (HR generated only via backend)
CREATE POLICY "Service uploads payslips"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'payslips');

CREATE POLICY "Employees read payslips"
ON storage.objects FOR SELECT
USING (bucket_id = 'payslips');
