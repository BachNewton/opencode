/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { ConfigProvider } from "../../../src/config"
import { ArgsProvider } from "../../../src/context/args"
import { ClientProvider } from "../../../src/context/client"
import { DataProvider } from "../../../src/context/data"
import { Keymap } from "../../../src/context/keymap"
import { LocalProvider } from "../../../src/context/local"
import { LocationProvider } from "../../../src/context/location"
import { PermissionProvider } from "../../../src/context/permission"
import { RouteProvider } from "../../../src/context/route"
import { TuiAppProvider } from "../../../src/context/runtime"
import { SessionTabsProvider } from "../../../src/context/session-tabs"
import { StorageProvider, useStorage } from "../../../src/context/storage"
import { ThemeProvider } from "../../../src/context/theme"
import { context } from "../../../src/routes/session/render-context"
import { ToolPart } from "../../../src/routes/session"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { createApi, createFetch } from "../../fixture/tui-client"
import { emptyThemeSource, tmpdir } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { canonicalToolPart } from "../../mini/fixture/tool-part"

test.each(["error", "completed", "runtime-error"] as const)("opens execute detail after %s", async (status) => {
  const temporary = await tmpdir()
  const config = createTuiResolvedConfig()
  const part = canonicalToolPart(
    "execute",
    status === "error"
      ? { status, input: { code: 'throw new Error("boom")' }, error: { type: "unknown", message: "boom" } }
      : {
          status: "completed",
          input: { code: "return 42" },
          content: [{ type: "text", text: status === "runtime-error" ? "boom" : "42" }],
          metadata: { error: status === "runtime-error" },
        },
  )
  let storage!: ReturnType<typeof useStorage>

  function Probe() {
    storage = useStorage()
    return (
      <context.Provider
        value={{
          width: 80,
          terminal: { width: 80, height: 24 },
          sessionID: "ses_execute_test",
          thinkingMode: () => "hide",
          markdownMode: () => "rendered",
          groupExploration: () => false,
          diffWrapMode: () => "word",
          models: () => [],
          messageIndex: () => undefined,
          legacyTurns: () => false,
          config,
          mutatePending: async () => false,
          pendingDelivery: () => undefined,
        }}
      >
        <ToolPart part={part} images={false} />
      </context.Provider>
    )
  }

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state: temporary.path }}>
        <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
          <StorageProvider>
            <ArgsProvider>
              <ConfigProvider config={config}>
                <Keymap.Provider>
                  <ToastProvider>
                    <RouteProvider>
                      <ClientProvider api={createApi(createFetch().fetch)}>
                        <PermissionProvider>
                          <DataProvider directory={process.cwd()}>
                            <LocationProvider>
                              <SessionTabsProvider>
                                <ThemeProvider mode="dark" source={emptyThemeSource}>
                                  <LocalProvider>
                                    <DialogProvider>
                                      <Probe />
                                    </DialogProvider>
                                  </LocalProvider>
                                </ThemeProvider>
                              </SessionTabsProvider>
                            </LocationProvider>
                          </DataProvider>
                        </PermissionProvider>
                      </ClientProvider>
                    </RouteProvider>
                  </ToastProvider>
                </Keymap.Provider>
              </ConfigProvider>
            </ArgsProvider>
          </StorageProvider>
        </TuiAppProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 24, kittyKeyboard: true },
  )
  app.renderer.start()
  try {
    const frame = await app.waitForFrame((value) => value.includes("execute"))
    const row = frame.split("\n").findIndex((line) => line.includes("execute"))
    await app.mockMouse.click(6, row)
    const detail = await app.waitForFrame((value) => value.includes("Code") && value.includes("Output"))
    expect(detail).toContain(status === "completed" ? "Completed" : "Failed")
    expect(detail).toContain(status === "error" ? 'throw new Error("boom")' : "return 42")
    expect(detail).toContain(status === "completed" ? "42" : "boom")
  } finally {
    app.renderer.destroy()
    await storage.flush()
    await temporary[Symbol.asyncDispose]()
  }
})
