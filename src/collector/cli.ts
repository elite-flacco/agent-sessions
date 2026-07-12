import { syncAll, watchSources } from "./index";

async function main(): Promise<void> {
  const watch = process.argv.includes("--watch");
  const force = process.argv.includes("--force");
  const result = await syncAll({ force });
  if (result.locked) {
    console.log(
      "Relay sync skipped: another collector process is currently scanning.",
    );
  } else {
    console.log(
      `Relay sync: ${result.imported} imported, ${result.skipped} unchanged, ${result.errors} errors across ${result.sources} sources.`,
    );
  }

  if (watch) {
    const close = await watchSources();
    console.log(
      "Relay collector is watching local agent activity. Press Ctrl+C to stop.",
    );
    process.on("SIGINT", () => {
      void close().finally(() => process.exit(0));
    });
    await new Promise(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Relay collection failed",
  );
  process.exitCode = 1;
});
