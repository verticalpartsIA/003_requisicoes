-- Migration 007 — Itens de viagem por requisição (M2)

CREATE TABLE IF NOT EXISTS public.requisition_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id uuid NOT NULL REFERENCES public.requisitions(id) ON DELETE CASCADE,
  item_type      text NOT NULL CHECK (item_type IN ('voo', 'hotel', 'carro')),
  description    text,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'quoted', 'approved', 'rejected', 'purchased')),
  sort_order     int  NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.quotation_suppliers
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.requisition_items(id);

CREATE TABLE IF NOT EXISTS public.approval_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id   uuid NOT NULL REFERENCES public.approvals(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.requisition_items(id),
  item_type     text NOT NULL,
  supplier_name text,
  price         numeric,
  decision      text NOT NULL DEFAULT 'pending'
                  CHECK (decision IN ('pending', 'approved', 'rejected')),
  notes         text,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (approval_id, item_id)
);

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.requisition_items(id);

-- RLS for requisition_items
ALTER TABLE public.requisition_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY requisition_items_select ON public.requisition_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY requisition_items_insert ON public.requisition_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY requisition_items_update ON public.requisition_items
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

-- RLS for approval_items
ALTER TABLE public.approval_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_items_select ON public.approval_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY approval_items_insert ON public.approval_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY approval_items_update ON public.approval_items
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

GRANT SELECT, INSERT, UPDATE ON public.requisition_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.approval_items TO authenticated;
