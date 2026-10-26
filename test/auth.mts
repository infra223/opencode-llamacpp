// Discovery must authenticate with the env key, and the provider must be linked
// to its integration so OpenCode resolves the key for model requests too.
import assert from "node:assert/strict"
import { makeCtx, stubFetch } from "./harness.mts"

const key = process.env.LLAMACPP_API_KEY?.trim()
const DEFAULT_ENDPOINT = "http://127.0.0.1:8080/v1"

const fetchStub = stubFetch(["test-model"])
const { default: plugin } = await import(new URL("../index.ts", import.meta.url).href)
const h = makeCtx([undefined])

const cleanup = await plugin.setup(h.ctx as never)
cleanup?.()

assert.deepEqual(fetchStub.calls.map((c) => c.url), [`${DEFAULT_ENDPOINT}/models`])
if (key) {
  assert.deepEqual(
    fetchStub.calls[0]?.headers,
    { Authorization: `Bearer ${key}` },
    "discovery should send the configured bearer token",
  )
} else {
  assert.equal(fetchStub.calls[0]?.headers, undefined, "discovery should stay unauthenticated without a key")
}

assert.equal(h.added.length, 1, "should register the provider")
assert.equal(h.added[0]?.models[0]?.id, "test-model", "should register the discovered model")
assert.equal(
  h.added[0]?.info.integrationID,
  "llamacpp",
  "provider should be linked to its integration so OpenCode resolves the env API key",
)
assert.equal(
  (h.added[0]?.info.settings as Record<string, unknown>)?.baseURL,
  DEFAULT_ENDPOINT,
  "provider should get the default baseURL",
)

fetchStub.restore()
console.log(key ? "auth (keyed) OK" : "auth (keyless) OK")
