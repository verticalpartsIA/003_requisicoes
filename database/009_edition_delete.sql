-- Add edition column to track requisition revisions (starts at 1)
ALTER TABLE public.requisitions
  ADD COLUMN IF NOT EXISTS edition INTEGER NOT NULL DEFAULT 1;
