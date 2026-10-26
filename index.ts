import { Model, Plugin, Provider } from "@opencode/plugin"

const PROVIDER_ID = "llamacpp"

/** llama-server's own default listen port. */
const DEFAULT_ENDPOINT = "http://127.0.0.1:8080/v1"
/** Env var consulted for the API key unless `apiKeyEnv` overrides it. */
const DEFAULT_API_KEY_ENV = "LLAMACPP_API_KEY"

/** Endpoint precedence: plugin option, then `LLAMACPP_ENDPOINT`, then llama.cpp's default. */
function resolveEndpoint(options: Record<string, unknown>): string {
  const fromOption = typeof options.endpoint === "string" ? options.endpoint.trim() : ""
  const fromEnv = (process.env.LLAMACPP_ENDPOINT ?? "").trim()
  return fromOption || fromEnv || DEFAULT_ENDPOINT
}

/** Name of the env var holding the API key. */
function resolveApiKeyEnv(options: Record<string, unknown>): string {
  const fromOption = typeof options.apiKeyEnv === "string" ? options.apiKeyEnv.trim() : ""
  return fromOption || DEFAULT_API_KEY_ENV
}

interface ModelCard {
  id: string
  status?: { args?: string[] }
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
  }
}

const MODALITIES = new Set(["text", "image", "audio", "video"])

/** Reasoning effort levels offered as model variants for thinking-enabled models. */
const REASONING_LEVELS = ["low", "medium", "high", "xhigh"] as const

/** Read `--flag <value>` from the llama-server argv array. */
function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i === -1 || i + 1 >= args.length) return undefined
  return args[i + 1]
}

function numFlag(args: string[], name: string): number | undefined {
  const v = flag(args, name)
  if (v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function contextLimit(args: string[] | undefined): number | undefined {
  if (!args) return undefined
  const ctxSize = numFlag(args, "--ctx-size")
  if (ctxSize === undefined) return undefined
  // llama-server splits n_ctx evenly across parallel slots
  return Math.floor(ctxSize / (numFlag(args, "--parallel") ?? 1))
}

function modalities(list: string[] | undefined): string[] {
  const out = (list ?? []).filter((m) => MODALITIES.has(m))
  return out.length > 0 ? out : ["text"]
}

/**
 * True when the server card shows this model runs with thinking enabled:
 * `--reasoning on`, or `enable_thinking: true` in `--chat-template-kwargs`
 * (used when `--reasoning` is unset/auto and the template opts in itself).
 */
function thinkingEnabled(args: string[] | undefined): boolean {
  if (!args) return false
  const on = flag(args, "--reasoning")
  if (on === "on" || on === "true" || on === "1") return true
  if (on === "off" || on === "false" || on === "0") return false
  const kwargs = flag(args, "--chat-template-kwargs")
  if (kwargs) {
    try {
      const parsed = JSON.parse(kwargs) as { enable_thinking?: boolean }
      if (typeof parsed.enable_thinking === "boolean") return parsed.enable_thinking
    } catch {
      // malformed kwargs: fall through
    }
  }
  return false
}

/** llama-server only separates thinking text when `--reasoning on` is set. */
function reasoningField(args: string[] | undefined): string | undefined {
  if (!args) return undefined
  const on = flag(args, "--reasoning")
  if (on !== "on" && on !== "true" && on !== "1") return undefined
  // deepseek format (the common case) streams `reasoning_content` (verified live)
  return flag(args, "--reasoning-format") === "openai" ? "reasoning" : "reasoning_content"
}

export default Plugin.define({
  id: "llamacpp.discovery",
  async setup(ctx) {
    const levels =
      Array.isArray(ctx.options.reasoningLevels) && ctx.options.reasoningLevels.length > 0
        ? (ctx.options.reasoningLevels as readonly string[])
        : REASONING_LEVELS

    const endpoint = resolveEndpoint(ctx.options)
    const apiKeyEnv = resolveApiKeyEnv(ctx.options)
    const apiKey = (process.env[apiKeyEnv] ?? "").trim()
    // Only model discovery needs a header of our own; OpenCode authenticates
    // model requests through the integration env method registered below.
    const authHeaders: Record<string, string> | undefined = apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : undefined

    const load = async (): Promise<readonly Model.Info[] | null> => {
      try {
        const res = await fetch(`${endpoint}/models`, {
          headers: authHeaders,
          signal: AbortSignal.timeout(5_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { data?: ModelCard[] }
        if (!Array.isArray(body.data)) return null

        // Dedupe by id (a GGUF can be registered under multiple aliases).
        const seen = new Set<string>()
        const cards = body.data.filter((card) => {
          if (seen.has(card.id)) return false
          seen.add(card.id)
          return true
        })

        return cards.map((card) => {
          const base = Model.Info.default(
            Provider.ID.make(PROVIDER_ID),
            Model.ID.make(card.id),
          )
          const context = contextLimit(card.status?.args)
          const field = reasoningField(card.status?.args)
          const thinking = thinkingEnabled(card.status?.args)

          return {
            ...base,
            capabilities: {
              ...base.capabilities,
              input: modalities(card.architecture?.input_modalities), // ["text"] or ["text","image"] for mmproj models
              output: modalities(card.architecture?.output_modalities),
            },
            ...(context !== undefined
              ? { limit: { ...base.limit, context } }
              : {}),
            ...(field !== undefined
              ? { compatibility: { ...base.compatibility, reasoningField: field } }
              : {}),
            // Offer reasoning-effort variants where the server runs thinking;
            // a selected variant sends `reasoning_effort` per request, which
            // overrides the server's own template-kwargs default.
            ...(thinking
              ? {
                  variants: levels.map((level) => ({
                    id: Model.VariantID.make(level),
                    settings: { reasoningEffort: level },
                  })),
                }
              : {}),
          }
        })
      } catch (err) {
        console.error("llamacpp discovery:", err)
        return null // keep last known inventory on failure
      }
    }

    let models = (await load()) ?? []

    // Register the provider and its inventory here. A provider already defined
    // in opencode.jsonc arrives as `rec`: refresh its inventory and fill in the
    // connection settings it lacks, without overwriting anything configured.
    await ctx.provider.transform((editor) => {
      const rec = editor.get(PROVIDER_ID)
      if (rec) {
        editor.models.set(PROVIDER_ID, models)
        editor.update(PROVIDER_ID, (provider) => {
          const settings = (provider.settings ??= {})
          if (!settings.baseURL) settings.baseURL = endpoint
          if (!provider.integrationID) provider.integrationID = PROVIDER_ID
        })
      } else {
        editor.add({
          info: {
            ...Provider.Info.empty(Provider.ID.make(PROVIDER_ID)),
            name: "llama-server",
            activation: "enabled",
            package: "@opencode/ai/providers/openai-compatible",
            integrationID: PROVIDER_ID,
            settings: {
              baseURL: endpoint,
            },
          },
          models,
        })
      }
    })

    // Register the env credential method: OpenCode reads the variable named by
    // `apiKeyEnv` from the server process at request time. A saved `opencode
    // auth` account takes precedence over this, so a stale credential for the
    // same provider ID would mask it (check `opencode auth list`).
    if (ctx.integration) {
      await ctx.integration.transform((editor) => {
        editor.method.update({
          integrationID: PROVIDER_ID,
          method: { type: "env", names: [apiKeyEnv] },
        })
      })
    }

    const refresh = async () => {
      const next = await load()
      if (!next) return
      models = next
      await ctx.provider.reload()
    }

    const timer = setInterval(() => void refresh().catch(console.error), 60_000)
    return () => clearInterval(timer)
  },
})
