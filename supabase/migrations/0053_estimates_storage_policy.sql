-- Allow authenticated users to upload item images for calculator estimates
-- Path: uploads/estimates/* in the existing 'media' bucket

CREATE POLICY "estimates_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND name LIKE 'uploads/estimates/%'
  );

CREATE POLICY "estimates_select" ON storage.objects
  FOR SELECT TO public
  USING (
    bucket_id = 'media'
    AND name LIKE 'uploads/estimates/%'
  );

CREATE POLICY "estimates_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND name LIKE 'uploads/estimates/%'
  );
