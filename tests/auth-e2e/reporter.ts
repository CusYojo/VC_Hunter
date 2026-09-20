import type { Reporter, TestCase, TestResult, FullResult } from "@playwright/test/reporter";
import { readAuthFixture } from "./fixtures";

/** No screenshots, trace, request bodies, input values, or raw errors in authentication reports. */
export default class PrivateAuthReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    console.log(`[auth-e2e] ${result.status}: ${test.title}`);
    if (result.status !== "passed") {
      const accounts = readAuthFixture();
      const summary = result.errors[0]?.message?.split("\n")[0] ?? "Test did not complete";
      const redacted = [accounts.admin.password, accounts.member.password].reduce((text, secret) => text.replaceAll(secret, "[REDACTED]"), summary);
      console.log(`[auth-e2e] ${redacted.slice(0, 240)} (request/input details suppressed)`);
      const source = result.errors[0]?.stack?.split("\n").find((line) => /^\s+at .+tests\/auth-e2e\/.+:\d+:\d+\)?$/.test(line));
      if (source) console.log(`[auth-e2e] ${source.trim()}`);
    }
  }
  onEnd(result: FullResult) { console.log(`[auth-e2e] Overall: ${result.status}`); }
  onError() { console.error("[auth-e2e] Runner error; sensitive diagnostic output suppressed."); }
  printsToStdio() { return true; }
}
