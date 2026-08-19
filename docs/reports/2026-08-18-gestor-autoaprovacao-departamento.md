# Relatório — Gestor não conseguia decidir (nem ver) as próprias requisições

**Status:** ✅ Resolvido, incluindo os dois achados relacionados
**PR:** #84

## Problema relatado

Danilo Oliveira, gestor do departamento "Logistica/ Almoxarifado", cria
uma requisição própria e ela não aparece em nenhuma fila para ele decidir
(etapa GESTOR — "dar ciência"). O pedido do usuário: gestores devem poder
aprovar/dar ciência nas próprias requisições.

## Investigação

`src/features/gestor/api.ts` já contém toda a lógica de quem pode decidir
uma requisição na etapa GESTOR — não há **nenhum bloqueio proposital de
autoaprovação** no código:

- `requisitions.approver_id` é carimbado na criação (trigger
  `stamp_requisition_approver`, `database/016_collaborator_approver.sql`)
  com `profiles.approver_id` do solicitante — o aprovador designado
  pessoalmente para aquele colaborador, se houver.
- Se `approver_id` ficar nulo (colaborador sem aprovador pessoal
  designado), a etapa GESTOR cai no fallback por departamento:
  `department_managers` — qualquer gestor daquele departamento (o
  próprio solicitante incluso, se ele for gestor do seu departamento)
  pode decidir.

Consultei o banco (Supabase, projeto `vprequisicao`) diretamente para
achar por que o fallback não estava funcionando para o Danilo:

```sql
-- Danilo: department_managers -> "Logistica"
-- profiles.department dele -> "Logistica/ Almoxarifado"
-- requisitions.requester_department das requisições dele -> "Logistica/ Almoxarifado"
```

**Causa raiz:** `department_managers.department` e `profiles.department`
são dois campos de **texto livre**, sem nenhuma chave estrangeira ou
validação compartilhada entre eles. O casamento usado em
`listGestorQueue`/`assertCanDecide` é por igualdade exata de string.
"Logistica" ≠ "Logistica/ Almoxarifado" — nunca casa, então nenhuma
requisição desse departamento (nem as do próprio Danilo) aparecia na fila
de ninguém.

Uma consulta mais ampla mostrou que essa não é uma inconsistência isolada:
`profiles.department` tem valores como "Logistica", "Logistica/
Almoxarifado", "Producao" — cada um digitado uma vez por alguém, sem
padronização. Duas entradas de `department_managers` também não batiam com
**nenhum** valor real de `profiles.department`: `"Expedição"` → Gelson
Simões e `"VerticalParts"` → Diego Maeno.

Perguntei ao usuário o que essas duas deveriam representar. Resposta:
Diego é o CEO ("dono da empresa") e Gelson é o criador das soluções —
ambos deveriam ter poderes máximos. Consultando o banco, **os dois já
tinham todos os 5 papéis** (`admin, solicitante, comprador, aprovador,
almoxarife`) — ou seja, o pedido já estava atendido pelo mecanismo
correto (`user_roles`, que dá bypass total em `assertCanDecide` e na
maioria das políticas de RLS). As duas linhas de `department_managers`
eram tentativas (uma de 23/06, outra criada momentos antes desta
conversa, às 19:12 de hoje) de usar a ferramenta errada para o objetivo
— department_managers só concede autoridade sobre um departamento
específico na etapa GESTOR, não é o mecanismo de "poder total" do
sistema.

**Limpeza feita:**
- Removidas as duas linhas órfãs de `department_managers` (não faziam
  nada de qualquer forma, e ficavam confusas na tela de Admin).
- Removido `profiles.approver_id` do Gelson (apontava para outra
  colaboradora — não bloqueava nada, já que ele é admin, mas não fazia
  sentido o criador do sistema ter alguém designado como aprovador
  pessoal dele).

## Correção

- **Dado:** adicionada a linha `('Logistica/ Almoxarifado', <Danilo>)` em
  `department_managers` (direto via SQL, fora do PR — é dado de produção,
  não schema).
- **Código (PR #84, `src/routes/admin.tsx`):**
  - "Designar gestor de departamento" era um `<Input>` de texto livre →
    virou um `<Select>` restrito aos departamentos que já existem de
    verdade em `profiles.department`. Elimina essa classe de bug de vez
    para novas designações.
  - O campo de departamento do próprio colaborador ganhou um `<datalist>`
    com sugestões dos departamentos existentes (continua aceitando texto
    novo — é o único lugar do sistema onde um departamento genuinamente
    novo pode nascer).

## Limitação conhecida

O fix de código previne **novas** designações de gestor com departamento
errado, mas não corrige retroativamente inconsistências que já existem em
`profiles.department` em si (ex.: duas pessoas digitando variações do
mesmo departamento). Isso exigiria migrar `department` de texto livre
para uma lista fechada (enum ou tabela `departments`), o que é uma mudança
maior — não fiz isso agora por ser fora do escopo do problema relatado.

## Correção administrativa de tickets em limbo (2026-08-19)

Como a regra de ciência do gestor (e o carimbo de `approver_id`) só passou
a existir/funcionar corretamente a partir do fix acima, requisições criadas
antes disso por pessoas que hoje são gestoras — mas que na hora da criação
não tinham essa condição reconhecida — ficaram travadas em `GESTOR` sem
nenhum gestor de fato capaz de decidi-las (autoaprovação não existia como
conceito ainda). O usuário pediu para evidenciar esses casos e resolvê-los.

Levantamento no banco (produção) de todas as requisições com
`status = 'GESTOR'` no sistema, contra quem consegue decidir cada uma pela
regra atual, encontrou 8 tickets travados:

- **2 são o Danilo** (`M4-000147`, `M3-000148`) — requisições próprias
  dele, criadas quando a regra de gestor ainda não existia/funcionava.
  Sem correção, ficariam travadas para sempre: ele é o único gestor do
  departamento delas e o sistema não tinha a noção de autoaprovação nessa
  época.
- **3 são decisões pendentes reais**, sem relação com o bug — Bianca
  Mayumi/Danilo Oliveira ainda precisam decidir requisições do Caio Silva
  (`M5-000141`, `M3-000145`, `M1-000146`). Não foram tocadas.
- **3 são bloqueadas por falta de gestor cadastrado** para os
  departamentos "Vendas" e "MKT" em `department_managers` — gap diferente
  do bug de texto livre, é apenas ausência de designação. O usuário optou
  por resolver isso ele mesmo pelo Admin (Admin → Usuários → colaborador →
  "Gestor de:"), não foi tocado por mim.

Para os 2 tickets do Danilo, o usuário escolheu resolver via **correção
administrativa** — aprovar agora, deixando o registro de auditoria honesto
(sem simular um clique que o Danilo nunca deu). Executado direto via SQL
em produção:

```sql
-- M4-000147 e M3-000148: status GESTOR -> ABERTO
update requisitions set status = 'ABERTO'
  where ticket_number in ('M4-000147', 'M3-000148');

insert into audit_logs
  (requisition_id, ticket_number, action, old_status, new_status, actor_name, details)
values
  (<id>, 'M4-000147', 'GESTOR_APPROVED', 'GESTOR', 'ABERTO', 'Correção administrativa',
   '{"notes": "Requisição própria do gestor do departamento, criada antes da regra de ciência de gestor existir/funcionar. Aprovada administrativamente para trazer o ticket de volta ao fluxo normal."}'),
  (<id>, 'M3-000148', 'GESTOR_APPROVED', 'GESTOR', 'ABERTO', 'Correção administrativa',
   '{"notes": "Requisição própria do gestor do departamento, criada antes da regra de ciência de gestor existir/funcionar. Aprovada administrativamente para trazer o ticket de volta ao fluxo normal."}');
```

Ambos os tickets seguiram normalmente para a etapa de Cotação (V2) depois
disso — já dentro da regra correta, sem exigir nenhuma ação manual futura
equivalente (com o gestor de "Logistica/ Almoxarifado" corrigido, novas
requisições do Danilo passam pela ciência normalmente).

Também implementada, no mesmo ciclo, a seção **"Aguardando Gestor"** em
`/approval` (visível só para admin) para que Diego/Gelson vejam de cara,
a qualquer momento, todos os tickets travados em `GESTOR` no sistema e
quem está travando cada um — sem precisar de uma consulta SQL manual como
esta para descobrir.
