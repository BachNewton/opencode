import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionEvent } from "../src/session-event.js"
import { SessionMessage } from "../src/session-message.js"

const assistant = {
  id: "msg_terminal",
  type: "assistant" as const,
  agent: "build",
  model: { providerID: "openai", id: "gpt-test" },
  content: [],
  time: { created: 0 },
}

test("assistant terminal diagnostics remain optional and round trip", () => {
  const decode = Schema.decodeUnknownSync(SessionMessage.Assistant)
  const encode = Schema.encodeSync(SessionMessage.Assistant)

  expect(encode(decode(assistant))).toEqual(assistant)
  expect(
    encode(
      decode({
        ...assistant,
        finish: "content-filter",
        rawFinish: "SAFETY",
        native: { promptFeedback: { blockReason: "SAFETY" } },
      }),
    ),
  ).toMatchObject({
    finish: "content-filter",
    rawFinish: "SAFETY",
    native: { promptFeedback: { blockReason: "SAFETY" } },
  })
  const legacy = SessionMessage.persisted({
    ...assistant,
    providerState: { promptFeedback: { blockReason: "SAFETY" } },
    content: [{ type: "text", text: "hello", state: { signature: "sig" } }],
  })
  expect(decode(legacy)).toMatchObject({
    native: { promptFeedback: { blockReason: "SAFETY" } },
    content: [{ type: "text", native: { signature: "sig" } }],
  })
  expect(encode(decode(legacy))).not.toHaveProperty("providerState")
  expect(SessionMessage.persisted(assistant)).toBe(assistant)
})

test("replayed content updates keep the stored provider blob shape", () => {
  const content = [
    { type: "text", text: "hello", state: { signature: "sig" } },
    { type: "reasoning", text: "think", state: { id: "rs_1" }, time: { created: 1 } },
    { type: "tool", id: "call", name: "read", state: { status: "streaming", input: "" }, time: { created: 1 } },
  ] as const
  const decoded = Schema.decodeUnknownSync(SessionEvent.MessageContentUpdated.data)({
    sessionID: "ses_terminal",
    messageID: "msg_terminal",
    content,
  })
  expect(decoded.content).toEqual(content)
  expect(
    Schema.decodeUnknownSync(Schema.Array(SessionMessage.AssistantContent))(
      SessionMessage.persistedContent(decoded.content),
    ),
  ).toMatchObject([
    { type: "text", native: { signature: "sig" } },
    { type: "reasoning", native: { id: "rs_1" } },
    { type: "tool", state: { status: "streaming" } },
  ])
})

test("failed steps only override the assistant finish for content filters", () => {
  const decode = Schema.decodeUnknownSync(SessionEvent.Step.Failed.data)
  const input = {
    sessionID: "ses_terminal",
    assistantMessageID: "msg_terminal",
    error: { type: "provider.content-filter", message: "Blocked" },
  }

  expect(decode(input)).toMatchObject(input)
  expect(decode({ ...input, finish: "content-filter", rawFinish: "SAFETY" })).toMatchObject({
    finish: "content-filter",
    rawFinish: "SAFETY",
  })
  expect(() => decode({ ...input, finish: "stop" })).toThrow()
})

test("provider compaction context is optional, versioned and JSON-only", () => {
  const decode = Schema.decodeUnknownSync(SessionEvent.Compaction.Ended.data)
  const encode = Schema.encodeSync(SessionEvent.Compaction.Ended.data)
  const local = { sessionID: "ses_context", reason: "manual" as const, text: "summary", recent: "" }
  expect(encode({ ...decode(local), providerContext: undefined })).toEqual(local)
  const providerContext = {
    version: 1 as const,
    provenance: {
      providerID: "openai",
      provider: "openai",
      modelID: "deployment",
      route: "responses",
      protocol: "responses",
      endpoint: "digest",
    },
    messages: [{ role: "assistant", content: [{ type: "compaction", provider: "openai", encrypted: "opaque" }] }],
  }
  expect(encode(decode({ ...local, providerContext }))).toEqual({ ...local, providerContext })
  expect(() => decode({ ...local, providerContext: { ...providerContext, version: 2 } })).toThrow()
  expect(() => decode({ ...local, providerContext: { ...providerContext, messages: [() => "invalid"] } })).toThrow()
})
