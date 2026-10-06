# Formulários fechavam e perdiam os dados ao trocar de aba (2026-10-06)

## Sintoma
Ao preencher uma requisição, sair para outra aba e voltar, o popup tinha fechado e,
ao reabrir, o que ainda não estava salvo havia sumido.

## Causa raiz
1. `supabase-js` (`autoRefreshToken`) reemite `SIGNED_IN` ao voltar para a aba e
   `TOKEN_REFRESHED` a cada renovação do token (não verificado localmente nesta
   investigação — comportamento conhecido do auth-js v2; o teste de regressão o simula).
2. `AuthProvider` (`src/features/auth/auth-context.tsx`) tratava todo evento como login
   novo: `setIsLoading(true)` + recarga de perfil/papéis.
3. `src/routes/__root.tsx` renderiza a tela de boot enquanto `isLoading` é verdadeiro,
   no lugar do `<Outlet />`. A rota desmonta e todo `useState` do wizard se perde.
4. O rascunho em `sessionStorage` existente restaurava só parte do estado: no M1 o item
   em digitação (`draft*`), `omieResult`, `stockInfo` e flags de UI não eram salvos.

## Correção
- `AuthProvider` guarda o `user.id` já carregado (`loadedUserIdRef`); evento com o mesmo
  usuário só atualiza `session`/`user`, sem `isLoading` nem recarga. Login de outro
  usuário e logout seguem o fluxo antigo.
- `products.tsx` persiste/restaura o item em edição e as validações. M2–M6 já persistiam
  todos os campos dos seus formulários.
- Teste: `src/features/auth/__tests__/auth-context.test.tsx` (falha sem o fix).

## Limites conhecidos
- Fotos (`File`) não são persistidas em `sessionStorage`; precisam ser anexadas de novo.
- Telas de cotação/aprovação/compra/recebimento e o M7 não têm rascunho; com o fix
  principal deixam de ser desmontadas ao voltar para a aba, mas F5 ainda zera.
