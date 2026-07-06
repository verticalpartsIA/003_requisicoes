-- Migration 012: bucket para PDFs de requisição gerados no navegador (substitui reportgen.io)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'requisition-pdfs',
  'requisition-pdfs',
  false,
  10485760,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload requisition pdfs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'requisition-pdfs');

CREATE POLICY "Authenticated users can update requisition pdfs"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'requisition-pdfs');

CREATE POLICY "Authenticated users can read requisition pdfs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'requisition-pdfs');
