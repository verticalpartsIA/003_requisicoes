# Links de WhatsApp para ciência e aprovação — investigação (15/10/2026)

## Pergunta
Os links de ciência e de aprovação por alçada chegam, os donos veem, e eles decidem por eles?

## Evidências (produção, somente leitura)
- **Enviados: sim.** Últimos 30 dias: 55 avisos de ciência (9 números) e 79 de aprovação (5 números), todos `sent` em `whatsapp_notification_log`.
- **Vistos: sim.** Histórico da Evolution API de Bianca (nível 1), Juliana (nível 2) e Diego (nível 3): todas as mensagens `READ`, inclusive os links de aprovação (24 / 6 / 7 links de um toque).
- **Usados: não.** 37 links emitidos desde 02/10, **0** com `used_at`. As 80 decisões de 30 dias vieram do sistema logado (`audit_logs.details.via` nunca é `whatsapp_quick_link`). Ciência não tem link de um toque (`/approval?req=` exige login).
- Aprovações lidas e não decididas dentro das 4 h (ex.: Diego em 14/10, 4 mensagens; Juliana M1-000227).
- Página `/aprovar/<token>` testada em produção com token de teste: carrega e mostra os botões, porém só depois de ~12 s de tela de abertura (vídeo em `__root.tsx`, antes do teste de rota pública). Hipótese, não confirmada, para a baixa adesão.
- Limites: não há log de abertura da página; o histórico lido foi a página mais recente (50 mensagens) de cada contato.

## Mudanças
1. `QUICK_LINK_TTL_HOURS` 4 → 24; página mostra data+hora do vencimento; migração `database/038_quick_link_24h.sql` (apenas mensagem de erro de `quick_decide_approval`). Links já emitidos mantêm o prazo antigo (o `expires_at` é gravado na emissão).
2. **Gatilho que faltava — correção de preço** (`correctQuotationPriceClient`): a aprovação volta a `pending`, possivelmente em outra alçada, e ninguém era avisado. Agora o `quoting.tsx` dispara `APROVACAO_PENDENTE` com o novo total.
3. **Gatilho que faltava — reenvio após reprovação/devolução** (`updateRequisition`): o ticket volta a `ABERTO` (Cotação) sem aviso ao cotador. Agora `updateRequisitionClient` dispara `COMPRADOR_COTAR` quando `resumedToQuotation`.

## Auditoria dos gatilhos (estado após as mudanças)
| Evento | Mensagem |
|---|---|
| Criação M1–M6 (→ GESTOR) | `LIDER_CIENCIA` ✔ (6 rotas) |
| Ciência aprovada / reprovada | `COMPRADOR_COTAR` + `REQUISITANTE_CIENCIA_OK` / `REQUISITANTE_REPROVADO_GESTOR` ✔ |
| Cotação finalizada (3 caminhos) | `APROVACAO_PENDENTE` ✔ |
| Correção de preço (reaprovação) | `APROVACAO_PENDENTE` ✔ **(novo)** |
| Aprovação total / parcial / reprovação (sistema e link) | `COMPRA_APROVADA` + `REQUISITANTE_*` ✔ |
| Edição após reprovação/devolução → Cotação | `COMPRADOR_COTAR` ✔ **(novo)** |
| Compra / recebimento | `REQUISITANTE_COMPRADO` / `EXPEDICAO_RECEBIMENTO` ✔ |

## Pendências (não alteradas, decisão do Gelson)
- **Devolução por falta de informação** (`returnQuotationForInfoClient`): o solicitante não recebe WhatsApp (não existe estágio para isso).
- **Reprovação do gestor seguida de edição**: o ticket continua `REJEITADO` (comentado como fora de escopo em `requisitions/api.ts`); nenhum aviso sai.
- **Destinatários de `APROVACAO_PENDENTE`**: só aprovadores com `approval_tier` **exatamente** igual ao nível; o banco, ao decidir, aceita tier ≥ nível, e admins não recebem. Ex.: Diego (nível 3) decidiu uma aprovação de nível 2 sem ter sido avisado.
- Token de teste emitido na investigação (aprovação M1-000241, usuário Gelson): expira sozinho; apagar de `approval_quick_links` se preferir.
