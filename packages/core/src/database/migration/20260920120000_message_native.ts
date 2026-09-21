import { Effect, Predicate, Schema } from "effect"
import { SessionMessage } from "../../session/message.js"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260920120000_message_native",
  up(tx) {
    return Effect.gen(function* () {
      const rows = yield* tx.all<{ id: string; type: string; data: string }>(
        `SELECT id, type, data FROM session_message WHERE type IN ('assistant', 'compaction')`,
      )
      yield* Effect.forEach(rows, (row) =>
        Effect.gen(function* () {
          const stored = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(row.data)
          if (!Predicate.isObject(stored)) return
          const next = SessionMessage.persisted({ ...stored, type: row.type })
          if (!Predicate.isObject(next)) return
          const data = Object.fromEntries(Object.entries(next).filter(([key]) => key !== "type"))
          if (JSON.stringify(data) === JSON.stringify(stored)) return
          yield* tx.run(
            `UPDATE session_message SET data = '${quote(JSON.stringify(data))}' WHERE id = '${quote(row.id)}'`,
          )
        }),
      )
    })
  },
}

function quote(value: string) {
  return value.replaceAll("'", "''")
}

export default migration
