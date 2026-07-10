-- Camada OAuth 2.1 mínima (Dynamic Client Registration + authorization code + PKCE)
-- para o servidor MCP remoto, exigida pelo fluxo de conectores do claude.ai.
-- Sem policies: acesso somente via service_role (usado pela Edge Function).

create table if not exists public.mcp_oauth_clients (
  client_id text primary key,
  client_name text,
  redirect_uris jsonb not null,
  created_at timestamp with time zone not null default now()
);
alter table public.mcp_oauth_clients enable row level security;

create table if not exists public.mcp_oauth_codes (
  code text primary key,
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  used boolean not null default false
);
alter table public.mcp_oauth_codes enable row level security;

create table if not exists public.mcp_oauth_tokens (
  token_hash text primary key,
  client_id text not null references public.mcp_oauth_clients (client_id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone,
  revoked boolean not null default false
);
alter table public.mcp_oauth_tokens enable row level security;
