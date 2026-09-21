# M5 (Frete) — formulário estruturado a partir do histórico de tickets + procedimento oficial

## Contexto

Pedido do usuário a partir do ticket M5-000185: a descrição da carga
("Elevador eletrico SMR - 03 paradas - 630kilos (8 passageiros) 19 caixas -
4342 Kilos_11.917 m³. Necessário caminhão munck para desovar carga + 02
paleteiras hidraulicas e 02 ajudantes.") mostrava que informação estruturada
importante (especificações do elevador, necessidade de Munck/paleteira/
ajudantes) estava sendo digitada como texto livre dentro de
`description`/`justification`, sem campos próprios no formulário nem no PDF.

## Investigação

### Histórico dos 8 tickets M5 existentes (M5-000103 até M5-000185)

Consulta direta ao Supabase (`requisitions` filtrando `module = 'M5'`),
cruzando `module_data`, `description`, `justification` e `requester_department`:

- Origem quase sempre fixa: "Porto de Santos"/"Porto Santos" em 7 de 8 tickets.
- Solicitante quase sempre da Engenharia (7/8) — o único fora do padrão é
  Qualidade (M5-000141, peça de teste interna, sem elevador, sem Munck).
- 6 de 8 tickets descrevem elevador(es) vindos do porto, sempre com o mesmo
  conjunto de variáveis em texto livre: modelo/tipo, capacidade (kg),
  passageiros, número de paradas, número de caixas/volumes, peso total,
  volume (m³), referência a "pack list".
- Os 4 tickets mais recentes (M5-000166, 179, 183, 185, todos de setembro,
  todos da mesma requisitante) pedem explicitamente, na mesma ordem:
  "caminhão munck para desovar a carga + N paleteiras hidráulicas + N
  ajudantes" — um padrão operacional recorrente, não uma exceção.
- `unloading_location` e `destination_address` são preenchidos quase sempre
  com o mesmo texto duplicado.
- Nome do cliente/projeto nunca é um campo estruturado — aparece embutido em
  texto livre ("Projeto do Cliente VIP Gails", "Projeto Unique") ou é
  confundido com o próprio `project_number`.
- M5-000107 e M5-000118 têm **múltiplos elevadores no mesmo frete** (3 e 4
  unidades, cada um com capacidade/paradas diferentes).
- `project_number` é inconsistente: ora número de projeto real
  ("28778/776 - SF"), ora nome de projeto ("Projeto Unique"), ora nulo mesmo
  em obra.

### Comparação com o procedimento oficial de Compras

O usuário também passou o formulário interno "PROCEDIMENTO PARA SOLICITAÇÃO
DE COTAÇÃO/CONTRATAÇÃO DE TRANSPORTE E/OU LOCAÇÃO DE MUNCK" (hoje só
circula por e-mail para compras@verticalparts.com.br), explicitamente como
referência, não como verdade absoluta a ser copiada sem crítica.

Confirma o levantamento dos tickets (Ajudante/Paleteira com quantidade,
fotos do local) e amplia em pontos que a prática registrada nos tickets não
cobria:

- **Transporte e Locação de Munck são dois serviços logicamente separáveis**
  no processo oficial (dois toggles independentes) — o que também responde
  à pergunta original do usuário sobre cotar com fornecedores diferentes.
- **"Local do serviço" (onde o Munck atua) pode ser diferente do "Endereço
  de entrega"** — hoje o código só tinha `destination_address` +
  `unloading_location`, sempre duplicados na prática.
- Campos técnicos do Munck (tonelagem por faixa, tamanho da lança, tempo
  estimado de uso em horas, capacidade/comprimento do caminhão em
  toneladas/metros) **nunca apareceram em nenhum dos 8 tickets reais** —
  granularidade que o processo formal pede mas que ninguém preenche hoje.
- Regra de prazo mínimo de 7 dias antes do serviço para cotação/trâmites —
  **contradita pela prática real** (ex.: M5-000141 foi criado 1 dia antes do
  serviço). Não virou bloqueio no formulário, só aviso não-bloqueante.

## Decisão de escopo

Implementado nesta rodada, inteiramente em `module_data` (JSONB, sem
migração de banco, consistente com o modelo "sem tabela por módulo"
descrito no `CLAUDE.md`):

- Wizard M5 (`src/routes/freight.tsx`) ganhou um 4º passo ("Serviços") e
  campos novos: `client_name`, `site_supervisor`, `cargo_type` +
  `elevator_items[]` (lista, suporta múltiplos elevadores por frete),
  `needs_transport`/`vehicle_capacity_ton`/`vehicle_length_m`,
  `needs_munck`/`service_location_address`/`munck_quantity`/`munck_size`/
  `munck_boom_length_m`/`munck_usage_hours`, `additional_equipment[]`
  (paleteira, paleteira elétrica, cinta de elevação, ganchos, ajudante,
  outros — cada um com quantidade/especificação), `cargo_height_m`/
  `cargo_length_m`, `service_time`. Aviso não-bloqueante quando a data do
  serviço é a menos de 7 dias de antecedência.
- Bloco de PDF do M5 (`src/features/pdf/template.ts`) reescrito — o bloco
  anterior só imprimia `unloading_location` e a foto (e ainda referenciava
  `moduleData.cargo_description`, um campo que nunca existiu em
  `module_data`, sempre "—"). Agora imprime todos os campos acima, além de
  origem/destino/tipo de veículo/nº do projeto/quem recebe, que também
  nunca apareciam no PDF.
- Testes novos em `src/features/pdf/__tests__/template.test.ts` cobrindo o
  bloco M5 (dados presentes e ausentes).

### Fora de escopo nesta rodada (follow-up)

A ideia original do usuário — cotar Transporte, Munck e Ajudantes com
fornecedores diferentes, mínimo de 3 propostas por item, fechamento
independente por item — é tecnicamente viável reaproveitando o mesmo padrão
já usado por M1 (produtos) e M2 (viagem fracionada): `requisition_items` →
`quotation_suppliers`/`approval_items`/`purchases`, todos já ligados por
`item_id`/`item_type` (hoje limitado a `voo`/`hotel`/`carro`/`produto` por
`CHECK` constraint). Isso não entrou nesta entrega porque mexe no motor de
cotação/aprovação/compra compartilhado com M1-M4 (`quoting.tsx`,
`approval.tsx`, `purchasing.tsx`) e merece desenho e testes próprios, sem
arriscar os fluxos em produção desses outros módulos numa mudança já grande.
