import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"
import { redactConfig } from "./redact"

export const ConfigCommand = effectCmd({
  command: "config",
  describe: "show resolved configuration",
  builder: (yargs) =>
    yargs.option("reveal-secrets", {
      type: "boolean",
      default: false,
      describe: "show unredacted credentials in the output (unsafe to share)",
    }),
  handler: Effect.fn("Cli.debug.config")(function* (args) {
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const config = yield* Config.Service.use((cfg) => cfg.get())
    process.stdout.write(JSON.stringify(args.revealSecrets ? config : redactConfig(config), null, 2) + EOL)
  }),
})
