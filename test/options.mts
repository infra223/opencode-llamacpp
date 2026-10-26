// Endpoint and API-key env var name are configurable: plugin option first,
// LLAMACPP_ENDPOINT as fallback, llama.cpp's default port last.
import assert from "node:assert/strict"
import { makeCtx, stubFetch } from "./harness.mts"

const { default: plugin } = await import(new URL("../index.ts", import.meta.url).href)

// 1. Explicit plugin option wins for discovery and provider settings.
{
  const fetchStub = stubFetch(["m"])
  const h = makeCtx([undefined], { endpoint: "http://box:9000/v1" })
  const cleanup = await plugin.setup(h.ctx as never)
  cleanup?.()
  assert.equal(fetchStub.calls[0]?.url, "http://box:9000/v1/models", "option endpoint should be used for discovery")
  assert.equal(
    (h.added[0]?.info.settings as Record<string, unknown>)?.baseURL,
    "http://box:9000/v1",
    "option endpoint should become the provider baseURL",
  )
  fetchStub.restore()
}

// 2. LLAMACPP_ENDPOINT env fallback, and options still beat it.
{
  process.env.LLAMACPP_ENDPOINT = "http://from-env:1234/v1"
  const fetchStub = stubFetch(["m"])
  const h = makeCtx([undefined])
  const cleanup = await plugin.setup(h.ctx as never)
  cleanup?.()
  assert.equal(fetchStub.calls[0]?.url, "http://from-env:1234/v1/models", "LLAMACPP_ENDPOINT should be honoured")

  const stub2 = stubFetch(["m"])
  const h2 = makeCtx([undefined], { endpoint: "http://option-wins:1/v1" })
  const cleanup2 = await plugin.setup(h2.ctx as never)
  cleanup2?.()
  assert.equal(stub2.calls[0]?.url, "http://option-wins:1/v1/models", "the option should win over the env var")

  delete process.env.LLAMACPP_ENDPOINT
  fetchStub.restore()
  stub2.restore()
}

// 3. apiKeyEnv picks which variable holds the key, for discovery and for OpenCode.
{
  process.env.MY_LLM_KEY = "sekret"
  const fetchStub = stubFetch(["m"])
  const h = makeCtx([undefined], { apiKeyEnv: "MY_LLM_KEY" })
  const cleanup = await plugin.setup(h.ctx as never)
  cleanup?.()
  assert.deepEqual(
    fetchStub.calls[0]?.headers,
    { Authorization: "Bearer sekret" },
    "discovery should authenticate with the configured env var",
  )
  assert.deepEqual(
    h.envMethods[0]?.method,
    { type: "env", names: ["MY_LLM_KEY"] },
    "the env method should register the configured variable name",
  )
  delete process.env.MY_LLM_KEY
  fetchStub.restore()
}

console.log("options OK")
