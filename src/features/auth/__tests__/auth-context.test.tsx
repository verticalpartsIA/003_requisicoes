import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type AuthListener = (event: string, session: unknown) => void;

const h = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
}));

const user = { id: "user-1", email: "a@vp.com" };
const sessionFor = (id: string, token = "t1") => ({ access_token: token, user: { ...user, id } });

vi.mock("@/lib/supabase-browser", () => {
  const query = (data: unknown) => {
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.maybeSingle = () =>
      Promise.resolve(
        h.failProfile ? { data: null, error: new Error("rede") } : { data, error: null },
      );
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
    return q;
  };
  return {
    supabaseBrowser: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: sessionFor("user-1") } }),
        getUser: () => Promise.resolve({ data: { user } }),
        onAuthStateChange: (cb: AuthListener) => {
          h.listener = cb;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
      },
      from: (table: string) =>
        table === "profiles"
          ? query({ id: "user-1", full_name: "A", department: null, email: "a@vp.com" })
          : query([{ role: "solicitante", approval_tier: null }]),
    },
  };
});

import { AuthProvider, useAuth } from "../auth-context";

function Probe({ onRender }: { onRender: (v: ReturnType<typeof useAuth>) => void }) {
  onRender(useAuth());
  return null;
}

describe("AuthProvider — revalidação da sessão ao voltar para a aba", () => {
  beforeEach(() => {
    h.listener = null;
    h.failProfile = false;
  });

  async function setup() {
    const renders: ReturnType<typeof useAuth>[] = [];
    render(
      <AuthProvider>
        <Probe onRender={(v) => renders.push(v)} />
      </AuthProvider>,
    );
    await waitFor(() => expect(renders.at(-1)?.isLoading).toBe(false));
    await waitFor(() => expect(renders.at(-1)?.roles).toContain("solicitante"));
    return renders;
  }

  it.each(["SIGNED_IN", "TOKEN_REFRESHED"])(
    "%s do mesmo usuário não volta a ligar isLoading (não desmonta o app)",
    async (event) => {
      const renders = await setup();
      const before = renders.length;

      await act(async () => {
        h.listener?.(event, sessionFor("user-1", "novo-token"));
      });

      const after = renders.slice(before);
      expect(after.length).toBeGreaterThan(0);
      expect(after.every((r) => r.isLoading === false)).toBe(true);
      expect(renders.at(-1)?.session).toMatchObject({ access_token: "novo-token" });
      expect(renders.at(-1)?.roles).toContain("solicitante");
    },
  );

  it("login de OUTRO usuário continua recarregando perfil com isLoading", async () => {
    const renders = await setup();
    const before = renders.length;

    await act(async () => {
      h.listener?.("SIGNED_IN", sessionFor("user-2"));
    });

    expect(renders.slice(before).some((r) => r.isLoading === true)).toBe(true);
    await waitFor(() => expect(renders.at(-1)?.isLoading).toBe(false));
  });

  it("se a busca de perfil falhar, o próximo evento do mesmo usuário tenta de novo", async () => {
    h.failProfile = true;
    const renders: ReturnType<typeof useAuth>[] = [];
    render(
      <AuthProvider>
        <Probe onRender={(v) => renders.push(v)} />
      </AuthProvider>,
    );
    await waitFor(() => expect(renders.at(-1)?.isLoading).toBe(false));
    expect(renders.at(-1)?.roles).toEqual([]);

    h.failProfile = false;
    await act(async () => {
      h.listener?.("TOKEN_REFRESHED", sessionFor("user-1", "t2"));
    });

    await waitFor(() => expect(renders.at(-1)?.roles).toContain("solicitante"));
    expect(renders.at(-1)?.isLoading).toBe(false);
  });

  it("SIGNED_OUT limpa a sessão", async () => {
    const renders = await setup();
    await act(async () => {
      h.listener?.("SIGNED_OUT", null);
    });
    expect(renders.at(-1)?.session).toBeNull();
    expect(renders.at(-1)?.roles).toEqual([]);
  });
});
