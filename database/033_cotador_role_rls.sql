-- RLS para o novo role 'cotador' (ver 032_cotador_role.sql): dá ao cotador
-- o mesmo acesso que o comprador já tinha para a etapa de Cotação
-- (quotations, quotation_suppliers, pedido de aprovação, e update da
-- requisição enquanto ela está em ABERTO/COTAÇÃO). Não estende acesso a
-- purchases nem aos status de COMPRA/RECEBIMENTO — isso continua exclusivo
-- do role 'comprador'.

create or replace function private.can_view_requisition(target_requisition_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.requisitions
    where id = target_requisition_id
      and (
        created_by = auth.uid()
        or requester_profile_id = auth.uid()
        or private.has_any_role(
          array['admin', 'comprador', 'cotador', 'aprovador', 'almoxarife']::public.app_role[]
        )
      )
  );
$$;

drop policy if exists requisitions_update_cotador on public.requisitions;
create policy requisitions_update_cotador
on public.requisitions
for update
to authenticated
using (
  private.has_role('cotador')
  and status in ('ABERTO', 'COTAÇÃO')
)
with check (
  private.has_role('cotador')
);

drop policy if exists quotations_manage_comprador on public.quotations;
create policy quotations_manage_comprador
on public.quotations
for all
to authenticated
using (private.has_any_role(array['admin', 'comprador', 'cotador']::public.app_role[]))
with check (private.has_any_role(array['admin', 'comprador', 'cotador']::public.app_role[]));

drop policy if exists quotation_suppliers_manage_comprador on public.quotation_suppliers;
create policy quotation_suppliers_manage_comprador
on public.quotation_suppliers
for all
to authenticated
using (private.has_any_role(array['admin', 'comprador', 'cotador']::public.app_role[]))
with check (private.has_any_role(array['admin', 'comprador', 'cotador']::public.app_role[]));

drop policy if exists approvals_insert_comprador on public.approvals;
create policy approvals_insert_comprador
on public.approvals
for insert
to authenticated
with check (private.has_any_role(array['admin', 'comprador', 'cotador']::public.app_role[]));
