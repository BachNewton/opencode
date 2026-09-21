export * as SessionFork from "./session-fork.js"

import { Schema } from "effect"
import { Agent } from "./agent.js"
import { FinishReason } from "./llm.js"
import { Model } from "./model.js"
import { SessionMessage } from "./session-message.js"

export const Boundary = Schema.Union([
  Schema.Struct({ type: Schema.Literal("before"), messageID: SessionMessage.ID }),
  Schema.Struct({ type: Schema.Literal("through"), messageID: SessionMessage.ID }),
]).annotate({ identifier: "Session.ForkBoundary" })
export type Boundary = typeof Boundary.Type

export interface Continuation extends Schema.Schema.Type<typeof Continuation> {}
export const Continuation = Schema.Struct({
  prompt: Schema.String,
  response: Schema.String,
  agent: Agent.ID,
  model: Model.Ref,
  finish: FinishReason,
}).annotate({ identifier: "Session.ForkContinuation" })
