import { expect, test } from "bun:test"
import path from "path"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"

const location = { directory, project: { id: "project", directory, canonical: directory } }

function sessionInfo(id: string) {
  return {
    id,
    title: "Restarted session",
    projectID: "project",
    location: { directory },
    agent: "build",
    model: { providerID: "provider", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
}

function render(state: string, sessionID: string, respond: (attempt: number) => Response) {
  let attempts = 0
  const setup = createAppFixture({
    state,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "on" } },
    fetch: (url) => {
      if (url.pathname === `/api/session/${sessionID}`) return respond(++attempts)
      if (url.pathname === "/api/fs/list") return json({ location, data: [] })
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/session") return json({ data: [], cursor: {} })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
    },
  })
  return { setup, attempts: () => attempts }
}

async function openTabs(state: string) {
  const file = Bun.file(path.join(state, "test", "tui", "tabs.json"))
  if (!(await file.exists())) return []
  const stored: { cwd: Record<string, { tabs: { sessionID: string }[] }> } = await file.json()
  return Object.values(stored.cwd).flatMap((scope) => scope.tabs.map((tab) => tab.sessionID))
}

async function wait(fn: () => boolean | Promise<boolean>, label: string) {
  const start = Date.now()
  while (!(await fn())) {
    if (Date.now() - start > 5_000) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(10)
  }
}

test("a server restart keeps the session tab and loads it after reconnecting", async () => {
  await using state = await tmpdir()
  const rendered = render(state.path, "ses_restart", (attempt) =>
    attempt === 1 ? new Response(null, { status: 503 }) : json({ data: sessionInfo("ses_restart") }),
  )
  await using setup = await rendered.setup

  await setup.waitForFrame((frame) => frame.includes("UnexpectedStatus"))
  expect(await openTabs(state.path)).toEqual(["ses_restart"])

  setup.events.disconnect()
  await wait(() => rendered.attempts() > 1, "the session to reload after reconnecting")
  await setup.waitForFrame((frame) => frame.includes("Restarted session"))

  expect(await openTabs(state.path)).toEqual(["ses_restart"])
})

test("a missing session closes its tab", async () => {
  await using state = await tmpdir()
  const rendered = render(state.path, "ses_gone", () =>
    json(
      { _tag: "SessionNotFoundError", sessionID: "ses_gone", message: "Session not found: ses_gone" },
      { status: 404 },
    ),
  )
  await using setup = await rendered.setup

  await setup.waitForFrame((frame) => frame.includes("Session not found: ses_gone"))
  await wait(async () => !(await openTabs(state.path)).includes("ses_gone"), "the missing session tab to close")
})
