-- Decisão por item na Aprovação (V3) — M1 multi-itens e M2 — numa única
-- transação.
--
-- Antes, `decideItemsClient` (src/features/approvals/client.ts) gravava
-- direto do navegador: 1 UPDATE em approval_items POR ITEM (29 no maior
-- ticket M1 até hoje), depois requisition_items, approvals, requisitions e
-- audit_logs — tudo como chamadas HTTP separadas, sem transação. Uma queda
-- de conexão no meio deixava o ticket com parte dos itens decididos e a
-- aprovação ainda 'pending'. Com o botão "Aprovar todos" (aprovação em
-- massa) essa gravação passa a ser o caminho normal, então vira uma função
-- só: ou grava tudo, ou nada.
--
-- SECURITY INVOKER de propósito: roda com as permissões de quem chama, então
-- as policies de RLS existentes (approvals_update_aprovador,
-- requisitions_update_aprovador etc.) continuam valendo — a função não abre
-- nenhum acesso novo. As checagens explícitas abaixo só existem para dar
-- mensagem de erro clara (RLS sozinho faria o UPDATE afetar 0 linhas em
-- silêncio) e para validar regras de negócio que antes eram só do front.
--
-- p_decisions: [{"approval_item_id": "<uuid>", "decision": "approved"|"rejected"}, ...]
--   — precisa cobrir exatamente todos os itens da aprovação.
-- p_notes: observação do aprovador; obrigatória se algum item for reprovado
--   (vai para o requisitante na notificação de reprovação).

CREATE OR REPLACE FUNCTION public.decide_approval_items(
  p_approval_id uuid,
  p_decisions jsonb,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, private
AS $$
DECLARE
  v_approval       public.approvals%ROWTYPE;
  v_requisition    public.requisitions%ROWTYPE;
  v_notes          text := nullif(btrim(coalesce(p_notes, '')), '');
  v_now            timestamptz := now();
  v_total_items    int;
  v_given          int;
  v_matched        int;
  v_approved       int;
  v_rejected       int;
  v_all_rejected   boolean;
  v_next_status    public.requisition_status;
  v_rows           int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão expirada — entre novamente.';
  END IF;

  IF p_decisions IS NULL OR jsonb_typeof(p_decisions) <> 'array' THEN
    RAISE EXCEPTION 'Lista de decisões inválida.';
  END IF;

  SELECT * INTO v_approval FROM public.approvals WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aprovação não encontrada.';
  END IF;
  IF v_approval.decision <> 'pending' THEN
    RAISE EXCEPTION 'Esta aprovação já foi decidida por outra pessoa — atualize a página.';
  END IF;
  IF NOT private.can_approve_level(v_approval.approval_level) THEN
    RAISE EXCEPTION 'Você não tem alçada para aprovar o nível %.', v_approval.approval_level;
  END IF;

  SELECT * INTO v_requisition FROM public.requisitions
    WHERE id = v_approval.requisition_id FOR UPDATE;
  IF NOT FOUND OR v_requisition.status <> 'APROVAÇÃO' THEN
    RAISE EXCEPTION 'A requisição não está mais na etapa de Aprovação — atualize a página.';
  END IF;

  -- Decisões válidas, sem item repetido e cobrindo todos os itens da aprovação.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_decisions) d
    WHERE d->>'decision' IS NULL OR d->>'decision' NOT IN ('approved', 'rejected')
       OR d->>'approval_item_id' IS NULL
  ) THEN
    RAISE EXCEPTION 'Cada item precisa estar Aprovado ou Reprovado.';
  END IF;

  SELECT count(*) INTO v_total_items FROM public.approval_items WHERE approval_id = p_approval_id;
  SELECT count(DISTINCT d->>'approval_item_id'), count(*)
    INTO v_given, v_rows
    FROM jsonb_array_elements(p_decisions) d;
  SELECT count(*) INTO v_matched
    FROM public.approval_items ai
    JOIN jsonb_array_elements(p_decisions) d ON (d->>'approval_item_id')::uuid = ai.id
    WHERE ai.approval_id = p_approval_id;

  IF v_total_items = 0 THEN
    RAISE EXCEPTION 'Esta aprovação não tem itens para decidir.';
  END IF;
  IF v_rows <> v_given OR v_given <> v_total_items OR v_matched <> v_total_items THEN
    RAISE EXCEPTION 'Decida todos os % itens antes de confirmar.', v_total_items;
  END IF;

  SELECT count(*) FILTER (WHERE d->>'decision' = 'approved'),
         count(*) FILTER (WHERE d->>'decision' = 'rejected')
    INTO v_approved, v_rejected
    FROM jsonb_array_elements(p_decisions) d;

  IF v_rejected > 0 AND v_notes IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo da reprovação — ele é enviado ao requisitante.';
  END IF;

  v_all_rejected := v_approved = 0;
  v_next_status  := CASE WHEN v_all_rejected THEN 'REJEITADO' ELSE 'COMPRA' END;

  UPDATE public.approval_items ai
     SET decision = d->>'decision', notes = v_notes, decided_at = v_now
    FROM jsonb_array_elements(p_decisions) d
   WHERE ai.approval_id = p_approval_id
     AND ai.id = (d->>'approval_item_id')::uuid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> v_total_items THEN
    RAISE EXCEPTION 'Sem permissão para gravar a decisão dos itens.';
  END IF;

  UPDATE public.requisition_items ri
     SET status = d->>'decision'
    FROM public.approval_items ai
    JOIN jsonb_array_elements(p_decisions) d ON (d->>'approval_item_id')::uuid = ai.id
   WHERE ai.approval_id = p_approval_id
     AND ri.id = ai.item_id;

  UPDATE public.approvals
     SET decision = CASE WHEN v_all_rejected THEN 'rejected' ELSE 'approved' END::public.approval_decision,
         justification = v_notes,
         decided_at = v_now,
         approver_id = auth.uid()
   WHERE id = p_approval_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Sem permissão para registrar a aprovação.';
  END IF;

  UPDATE public.requisitions SET status = v_next_status WHERE id = v_requisition.id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Sem permissão para mudar o status da requisição.';
  END IF;

  -- actor_id/actor_name são preenchidos pelo trigger audit_logs_set_actor.
  INSERT INTO public.audit_logs (requisition_id, ticket_number, action, old_status, new_status, details)
  VALUES (
    v_requisition.id,
    v_requisition.ticket_number,
    CASE WHEN v_all_rejected THEN 'APPROVAL_REJECTED' ELSE 'APPROVAL_GRANTED' END,
    v_requisition.status,
    v_next_status,
    jsonb_build_object(
      'decisions', (
        SELECT jsonb_agg(jsonb_build_object('item_id', ai.item_id, 'decision', d->>'decision'))
          FROM public.approval_items ai
          JOIN jsonb_array_elements(p_decisions) d ON (d->>'approval_item_id')::uuid = ai.id
         WHERE ai.approval_id = p_approval_id
      ),
      'approved_count', v_approved,
      'rejected_count', v_rejected,
      'justification', v_notes
    )
  );

  RETURN jsonb_build_object(
    'approved_count', v_approved,
    'rejected_count', v_rejected,
    'new_status', v_next_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decide_approval_items(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_approval_items(uuid, jsonb, text) TO authenticated;
