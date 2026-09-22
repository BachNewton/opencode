import { describe, expect, test } from "bun:test"
import { renderUnicodeCompact } from "uqr"
import { renderPairingQr } from "./pair"

describe("pairing QR", () => {
  test.each(["\n", "\r\n"])("indents every row with %j output newlines", (newline) => {
    const link = "http://127.0.0.1:4096/connect#example"
    const rows = renderPairingQr(link, newline).split(newline)

    expect(rows.length).toBeGreaterThan(1)
    expect(rows.every((row) => row.startsWith("  "))).toBe(true)
    expect(rows.map((row) => row.slice(2)).join("\n")).toBe(renderUnicodeCompact(link, { border: 2 }))
  })
})
