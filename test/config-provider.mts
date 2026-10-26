// A provider already defined in opencode.jsonc gets the endpoint, the integration
// link, and the env method — without clobbering values set explicitly in config.
import assert from "node:assert/strict"
import { makeCtx, stubFetch, type ProviderRec } from "./harness.mts"

const DEFAULT_ENDPOINT = "http://127.0.0.1:8080/v1"

const fetchStub = stubFetch(["test-model"])
const { default: plugin } = await import(new URL("../index.ts", import.meta.url).href)

const bare: ProviderRec = { provider: { settings: {} } }
const custom: ProviderRec = { provider: { settings: { baseURL: "http://elsewhere/v1", apiKey: "user-set" } } }

const h = makeCtx([bare, custom])
const cleanup = await plugin.setup(h.ctx as never)
cleanup?.()

assert.equal(fetchStub.calls.length, 1, "should fetch the model list once")
assert.equal(h.modelsSet(), 2, "should refresh the model list for each provider record")

assert.equal(
  h.envMethods.length,
  1,
  "should register exactly one env integration method for the provider's API key",
)
assert.deepEqual(
  h.envMethods[0]?.method,
  { type: "env", names: ["LLAMACPP_API_KEY"] },
  "the env method should read LLAMACPP_API_KEY by default",
)
assert.equal(
  h.envMethods[0]?.integrationID,
  "llamacpp",
  "the env method should be registered under the provider's integration ID",
)

assert.equal(bare.provider.settings.baseURL, DEFAULT_ENDPOINT, "should fill in a missing baseURL")
assert.equal(bare.provider.integrationID, "llamacpp", "should link the record to its integration")
assert.equal(
  custom.provider.settings.baseURL,
  "http://elsewhere/v1",
  "should not overwrite an explicit baseURL",
)
assert.equal(custom.provider.settings.apiKey, "user-set", "should not touch unrelated config settings")

fetchStub.restore()
console.log("config-provider OK")
