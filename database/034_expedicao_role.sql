-- Novo role 'expedicao': permite ao admin designar quem recebe o aviso de
-- que um produto vai chegar/precisa ser expedido na empresa. Mesma lógica
-- de parametrização usada para 'cotador' em 032_cotador_role.sql — o
-- destinatário do gatilho é definido por papel, ajustável em /admin sem
-- tocar em código.
--
-- ALTER TYPE ... ADD VALUE precisa rodar isolado (não pode ser usado na
-- mesma transação em que é criado) — por isso fica em migração própria.
alter type public.app_role add value if not exists 'expedicao';
