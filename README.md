# opencode-llamacpp

OpenCode plugin for a self-hosted [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server`.

It polls `GET /v1/models` every 60s and registers each served GGUF as an OpenCode
model under the `llamacpp` provider, deriving from the server's own launch flags:

- **context limit** — `--ctx-size` divided by `--parallel` (llama-server splits `n_ctx` across slots)
- **vision input** — `architecture.input_modalities` for `mmproj` models
- **reasoning** — `--reasoning` / `--chat-template-kwargs`, exposing `low` / `medium` / `high` / `xhigh`
  variants that send `reasoning_effort` per request, and the matching `reasoningField`
  (`reasoning_content` vs `reasoning`)

## Install

```sh
opencode plugin add github:infra223/opencode-llamacpp
```

Or configure it directly in `opencode.json(c)` — relative paths resolve from the config file:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:infra223/opencode-llamacpp",
      "options": {
        "endpoint": "http://127.0.0.1:8080/v1"
      }
    }
  ]
}
```

Then select a model, e.g. `llamacpp/<model-id>`.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `endpoint` | `$LLAMACPP_ENDPOINT`, else `http://127.0.0.1:8080/v1` | llama-server OpenAI-compatible base URL |
| `apiKeyEnv` | `LLAMACPP_API_KEY` | name of the env var holding the server's `--api-key` |
| `reasoningLevels` | `low`, `medium`, `high`, `xhigh` | variants offered for thinking-enabled models |

## Authentication

If you start `llama-server --api-key <key>`, give OpenCode the same key through the
environment of the process that runs model requests:

```sh
# one-off private server
LLAMACPP_API_KEY=<key> opencode --standalone

# shared background service
opencode service set env LLAMACPP_API_KEY <key>
```

The plugin registers an integration `env` method, so the variable is read **at request
time** and never written into your config or stored as an account.

Check what OpenCode is actually using:

```sh
opencode auth list
# llamacpp  LLAMACPP_API_KEY   environment   <-- what you want
```

**Gotcha:** a saved account (`stored`) takes precedence over the env connection. If a
stale credential for `llamacpp` exists, requests authenticate with it and the server
answers `401`, which surfaces as `missing or wrong API key`. Remove it:

```sh
opencode auth list
opencode auth logout llamacpp <credential-id>
```

If you change the key, update the environment variable and restart the service
(`opencode service restart`); no re-login needed.

## Development

```sh
npm test              # keyless
LLAMACPP_API_KEY=x npm test   # also checks the bearer path
```

The tests stub `fetch` and the plugin's transform domains, so they run offline with a
plain Node install (no build step; the plugin ships as TypeScript and OpenCode loads it directly).

## License

MIT
