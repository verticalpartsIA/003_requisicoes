import { describe, expect, it, vi } from "vitest";
import { clearSiteCacheAndReload } from "@/lib/version-check";

function fakeWindow(opts: { cacheKeys?: string[]; withCaches?: boolean } = {}) {
  const deleted: string[] = [];
  const unregister = vi.fn().mockResolvedValue(true);
  const bodyRead = vi.fn().mockResolvedValue(new ArrayBuffer(0));
  const localStorageSetItem = vi.fn();
  const localStorageClear = vi.fn();
  const sessionStorageClear = vi.fn();
  const win = {
    caches:
      opts.withCaches === false
        ? undefined
        : {
            keys: vi.fn().mockResolvedValue(opts.cacheKeys ?? ["v1", "v2"]),
            delete: vi.fn(async (k: string) => {
              deleted.push(k);
              return true;
            }),
          },
    navigator: {
      serviceWorker: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) },
    },
    location: { pathname: "/approval", search: "?x=1", reload: vi.fn() },
    fetch: vi.fn().mockImplementation(async () => ({ ok: true, arrayBuffer: bodyRead })),
    localStorage: { clear: localStorageClear, setItem: localStorageSetItem, removeItem: vi.fn() },
    sessionStorage: { clear: sessionStorageClear },
    document: { cookie: "sb-session=abc" },
  };
  if (opts.withCaches === false) delete (win as { caches?: unknown }).caches;
  return { win, deleted, unregister, bodyRead, localStorageClear, sessionStorageClear };
}

describe("clearSiteCacheAndReload", () => {
  it("apaga o Cache Storage, remove service workers, rebusca a página e recarrega", async () => {
    const { win, deleted, unregister, bodyRead } = fakeWindow();
    const order: string[] = [];
    bodyRead.mockImplementation(async () => {
      order.push("body");
      return new ArrayBuffer(0);
    });
    win.location.reload.mockImplementation(() => order.push("reload"));
    await clearSiteCacheAndReload(win as unknown as Window & typeof globalThis);

    // O corpo das respostas é lido até o fim ANTES do reload.
    expect(order).toEqual(["body", "body", "reload"]);
    expect(deleted).toEqual(["v1", "v2"]);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(win.fetch).toHaveBeenCalledWith("/approval?x=1", {
      cache: "reload",
      credentials: "same-origin",
    });
    expect(win.fetch).toHaveBeenCalledWith("/", { cache: "reload", credentials: "same-origin" });
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it("não mexe no login SSO: cookies, localStorage e sessionStorage ficam intactos", async () => {
    const { win, localStorageClear, sessionStorageClear } = fakeWindow();
    await clearSiteCacheAndReload(win as unknown as Window & typeof globalThis);

    expect(localStorageClear).not.toHaveBeenCalled();
    expect(win.localStorage.removeItem).not.toHaveBeenCalled();
    expect(sessionStorageClear).not.toHaveBeenCalled();
    expect(win.document.cookie).toBe("sb-session=abc");
  });

  it("recarrega mesmo sem Cache Storage e com a rede falhando", async () => {
    const { win } = fakeWindow({ withCaches: false });
    win.fetch.mockRejectedValue(new Error("offline"));
    await clearSiteCacheAndReload(win as unknown as Window & typeof globalThis);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });
});
