// Shared mocks for the plugin's transform domains.

export type FetchStub = {
  calls: Array<{ url: string; headers?: Record<string, string> }>
  restore: () => void
}

/** Replace fetch with a `/v1/models` stub; records every call. */
export function stubFetch(cardIds: readonly string[] = ["test-model"]): FetchStub {
  const previous = globalThis.fetch
  const calls: FetchStub["calls"] = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string> | undefined })
    return new Response(
      JSON.stringify({ data: cardIds.map((id) => ({ id })) }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }) as typeof fetch
  return { calls, restore: () => (globalThis.fetch = previous) }
}

export type ProviderRec = { provider: { settings: Record<string, unknown> } }

export type Harness = {
  added: Array<{ info: Record<string, unknown>; models: readonly { id: string }[] }>
  envMethods: Array<{ integrationID: string; method: { type: string; names?: string[] } }>
  modelsSet: () => number
  ctx: unknown
}

/** Fake plugin context; `records` are the provider records the editor sees. */
export function makeCtx(records: (ProviderRec | undefined)[] = [undefined], options = {}): Harness {
  const added: Harness["added"] = []
  const envMethods: Harness["envMethods"] = []
  const models = { count: 0 }

  const ctx = {
    options,
    provider: {
      transform: async (callback: (editor: unknown) => void) => {
        for (const rec of records) {
          callback({
            get: () => rec,
            add: (input: { info: Record<string, unknown>; models: readonly { id: string }[] }) => {
              added.push(input)
            },
            update: (_id: string, fn: (provider: unknown) => void) => {
              if (rec) fn(rec.provider)
            },
            models: {
              set: () => {
                models.count += 1
              },
            },
          })
        }
      },
      reload: async () => {},
    },
    integration: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({
          method: {
            update(input: { integrationID: string; method: { type: string; names?: string[] } }) {
              envMethods.push(input)
            },
          },
        })
      },
      reload: async () => {},
    },
  }

  return {
    added,
    envMethods,
    modelsSet: () => models.count,
    ctx,
  }
}
