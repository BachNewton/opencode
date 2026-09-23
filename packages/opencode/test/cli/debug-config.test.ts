import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"
import { redactConfig } from "@/cli/cmd/debug/redact"

const config = {
  provider: {
    example: {
      options: {
        apiKey: "sk-example",
        timeout: 1200,
        headers: { Authorization: "Bearer example", "X-API-Key": "key" },
      },
      models: { demo: { variants: { fast: { api_key: "variant-secret" } } } },
    },
  },
  mcp: {
    remote: { oauth: { clientSecret: "oauth-secret", clientId: "public" }, headers: { "x-custom": "opaque" } },
    local: { environment: { SERVICE_TOKEN: "env-secret", PATH: "/usr/bin" } },
  },
  url: "https://user:pass@example.com/path",
  normal: { context_tokens: 200000, name: "example" },
}

describe("debug config redaction", () => {
  cliIt.live("hides resolved credentials unless explicitly revealed", ({ opencode }) =>
    Effect.gen(function* () {
      const content = JSON.stringify({ provider: config.provider })
      const env = { OPENCODE_CONFIG_CONTENT: content }
      const hidden = yield* opencode.spawn(["debug", "config"], { env })
      opencode.expectExit(hidden, 0, "debug config")
      expect(JSON.parse(hidden.stdout).provider.example.options).toMatchObject({
        apiKey: "***",
        timeout: 1200,
        headers: { Authorization: "***", "X-API-Key": "***" },
      })
      expect(hidden.stdout).not.toContain("sk-example")
      expect(hidden.stdout).not.toContain("Bearer example")

      const revealed = yield* opencode.spawn(["debug", "config", "--reveal-secrets"], { env })
      opencode.expectExit(revealed, 0, "debug config --reveal-secrets")
      expect(JSON.parse(revealed.stdout).provider.example.options).toMatchObject(config.provider.example.options)
    }),
  )

  cliIt.live("does not mutate the input and preserves unrelated settings", () =>
    Effect.sync(() => {
      const before = structuredClone(config)
      expect(redactConfig(config)).toEqual({
        provider: {
          example: {
            options: { apiKey: "***", timeout: 1200, headers: { Authorization: "***", "X-API-Key": "***" } },
            models: { demo: { variants: { fast: { api_key: "***" } } } },
          },
        },
        mcp: {
          remote: { oauth: { clientSecret: "***", clientId: "public" }, headers: { "x-custom": "***" } },
          local: { environment: { SERVICE_TOKEN: "***", PATH: "/usr/bin" } },
        },
        url: "***",
        normal: config.normal,
      })
      expect(config).toEqual(before)
    }),
  )
})
