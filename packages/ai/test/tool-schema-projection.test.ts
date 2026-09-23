import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { LLM, Tool } from "../src/index.js"
import { AnthropicMessages, Gemini, OpenAIChat, OpenAIResponses } from "../src/protocols.js"
import { ToolSchemaProjection } from "../src/protocols/utils/tool-schema.js"
import { Auth } from "../src/route.js"
import { compileRequest } from "../src/route/client.js"
import { it } from "./lib/effect.js"

describe("tool schema projections", () => {
  test("only normalizes typed empty input structs, preserving raw schemas and output schemas", () => {
    const schema = { not: { type: "null" } }
    const definitions = Tool.toDefinitions({
      typed: Tool.make({
        description: "Typed",
        parameters: Schema.Struct({}),
        success: Schema.Struct({}),
        execute: () => Effect.succeed({}),
      }),
      raw: Tool.make({ description: "Raw", jsonSchema: schema, execute: () => Effect.succeed({}) }),
    })
    expect(definitions[0]?.inputSchema).toEqual({ type: "object", properties: {}, additionalProperties: false })
    expect(definitions[0]?.outputSchema).toEqual(schema)
    expect(definitions[1]?.inputSchema).toEqual(schema)
  })

  test("retains empty input descriptions and preserves named outputs and explicit raw schemas", () => {
    const parameters = Schema.Struct({}).annotate({ identifier: "Ping", description: "No arguments" })
    const raw = { $ref: "#/$defs/Raw", $defs: { Raw: { not: { type: "null" }, description: "Raw schema" } } }
    const definitions = Tool.toDefinitions({
      typed: Tool.make({ description: "Ping", parameters, success: parameters, execute: () => Effect.succeed({}) }),
      raw: Tool.make({ description: "Raw", jsonSchema: raw, execute: () => Effect.succeed({}) }),
    })
    expect(definitions[0]?.inputSchema).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
      description: "No arguments",
    })
    expect(definitions[0]?.outputSchema).toEqual({
      $ref: "#/$defs/Ping",
      $defs: { Ping: { not: { type: "null" }, description: "No arguments" } },
    })
    expect(definitions[1]?.inputSchema).toEqual(raw)
  })

  const empty = { type: "object", properties: {}, additionalProperties: false }
  const nonempty = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  }
  const raw = { type: "object", properties: { value: { type: "number" } }, additionalProperties: true }

  for (const scenario of [
    {
      route: OpenAIChat.route,
      tools: [empty, nonempty, raw].map((parameters, index) => ({
        type: "function",
        function: { name: ["ping", "lookup", "raw"][index], parameters },
      })),
    },
    {
      route: OpenAIResponses.route,
      tools: [empty, nonempty, raw].map((parameters, index) => ({
        type: "function",
        name: ["ping", "lookup", "raw"][index],
        parameters,
      })),
    },
    {
      route: AnthropicMessages.route,
      tools: [empty, nonempty, raw].map((input_schema, index) => ({
        name: ["ping", "lookup", "raw"][index],
        input_schema,
      })),
    },
    {
      route: Gemini.route,
      tools: [
        {
          functionDeclarations: [
            { name: "ping", description: "Ping" },
            {
              name: "lookup",
              description: "Lookup",
              parameters: {
                type: "object",
                properties: nonempty.properties,
                required: nonempty.required,
              },
            },
            { name: "raw", description: "Raw", parameters: { type: "object", properties: raw.properties } },
          ],
        },
      ],
    },
  ]) {
    for (const input of [
      { name: "plain", schema: Schema.Struct({}) },
      { name: "described", schema: Schema.Struct({}).annotate({ description: "No arguments" }) },
      { name: "named", schema: Schema.Struct({}).annotate({ identifier: "Ping" }) },
      {
        name: "named and described",
        schema: Schema.Struct({}).annotate({ identifier: "Ping", description: "No arguments" }),
      },
    ]) {
      it.effect(
        `${scenario.route.id} prepares ${input.name} empty Effect Struct tools alongside nonempty and raw schemas`,
        () =>
          Effect.gen(function* () {
            const prepared = yield* compileRequest(
              LLM.request({
                model: scenario.route.with({ auth: Auth.bearer("test") }).model({ id: "test-model" }),
                prompt: "Use a tool.",
                tools: Tool.toDefinitions({
                  ping: Tool.make({
                    description: "Ping",
                    parameters: input.schema,
                    success: Schema.String,
                    execute: () => Effect.succeed("pong"),
                  }),
                  lookup: Tool.make({
                    description: "Lookup",
                    parameters: Schema.Struct({ query: Schema.String }),
                    success: Schema.String,
                    execute: (input) => Effect.succeed(input.query),
                  }),
                  raw: Tool.make({ description: "Raw", jsonSchema: raw, execute: () => Effect.succeed("raw") }),
                }),
              }),
            )
            expect(prepared.body.tools).toMatchObject(scenario.tools)
            if (scenario.route.id === "gemini") {
              expect(prepared.body.tools).toEqual(scenario.tools)
            }
          }),
      )
    }
  }

  test("moonshot strips $ref siblings and converts tuple arrays to a schema object", () => {
    expect(
      ToolSchemaProjection.moonshot({
        type: "object",
        properties: {
          linked: { $ref: "#/$defs/Linked", description: "drop me" },
          tuple: { type: "array", items: [{ type: "string" }, { type: "number" }] },
          prefixTuple: { type: "array", prefixItems: [{ type: "boolean" }, { type: "string" }] },
        },
      }),
    ).toEqual({
      type: "object",
      properties: {
        linked: { $ref: "#/$defs/Linked" },
        tuple: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
        prefixTuple: { type: "array", items: { anyOf: [{ type: "boolean" }, { type: "string" }] } },
      },
    })
  })

  test("gemini handles numeric enums, dangling required fields, untyped arrays, and scalar object keys", () => {
    expect(
      ToolSchemaProjection.gemini({
        type: "object",
        required: ["status", "missing"],
        properties: {
          status: { type: "integer", enum: [1, 2] },
          tags: { type: "array" },
          name: { type: "string", properties: { ignored: { type: "string" } }, required: ["ignored"] },
        },
      }),
    ).toEqual({
      type: "object",
      required: ["status"],
      properties: {
        status: { type: "string", enum: ["1", "2"] },
        tags: { type: "array", items: { type: "string" } },
        name: { type: "string" },
      },
    })
  })

  it.effect("applies model compatibility without changing schema semantics", () =>
    Effect.gen(function* () {
      const model = OpenAIChat.route
        .with({ endpoint: { baseURL: "https://api.openai.test/v1/" }, auth: Auth.bearer("test") })
        .model({ id: "kimi-k2", compatibility: { toolSchema: "moonshot" } })
      const prepared = yield* compileRequest(
        LLM.request({
          model,
          prompt: "Use the tool.",
          tools: [
            {
              name: "lookup",
              description: "Lookup data.",
              inputSchema: {
                type: "object",
                anyOf: [
                  {
                    type: "object",
                    properties: {
                      tuple: { type: "array", items: [{ type: "string" }, { type: "number" }] },
                      linked: { $ref: "#/$defs/Linked", description: "drop me" },
                    },
                  },
                ],
              },
            },
          ],
        }),
      )

      expect(prepared.body.tools?.[0]?.function.parameters).toEqual({
        type: "object",
        anyOf: [
          {
            type: "object",
            properties: {
              tuple: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
              linked: { $ref: "#/$defs/Linked" },
            },
          },
        ],
      })
    }),
  )
})
