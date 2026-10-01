import Anthropic from "@anthropic-ai/sdk";

/**
 * A failure caused by the engine's own setup (missing browser, bad API key or
 * model, rejected SMTP login) rather than by the lead. Workers throw this
 * instead of failing the lead, and the controller pauses the campaign so a
 * config mistake can't burn through the whole lead list.
 */
export class SetupError extends Error {}

export function asSetupError(err: unknown): SetupError | null {
  if (err instanceof SetupError) return err;
  const message = (err as Error)?.message ?? String(err);

  if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
    return new SetupError(
      "Chromium for the web auditor is not installed. Run `npx playwright install chromium` " +
        "(or set PLAYWRIGHT_EXECUTABLE_PATH in .env), then start the campaign again."
    );
  }
  if (/ANTHROPIC_API_KEY is not set/.test(message)) {
    return new SetupError("ANTHROPIC_API_KEY is not set. Add it to .env, restart the server, then start again.");
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new SetupError(`Claude rejected the API key (${message}). Fix ANTHROPIC_API_KEY in .env and restart.`);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new SetupError(`Claude model not found (${message}). Fix ANTHROPIC_MODEL in .env and restart.`);
  }
  if ((err as { code?: string })?.code === "EAUTH") {
    return new SetupError(`SMTP login rejected (${message}). Check that account's USER/PASS in .env and restart.`);
  }
  return null;
}
