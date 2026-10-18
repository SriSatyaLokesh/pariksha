// The development sender: it writes the message, link and all, to stdout so
// `pnpm dev` needs no email account.
//
// A sign-in link in a log is a sign-in link anyone with the log can use, and
// production logs are shipped, retained and searchable. So this does not
// become a quiet fallback when someone forgets to set `EMAIL_*` in
// production: it refuses to be constructed at all, and the instance fails to
// boot with a message naming the three variables. An operator who genuinely
// wants it — a single-user Docker install reading its own `docker logs` —
// says so with `EMAIL_CONSOLE=true`.

import type { AppEnv } from "../env.js";
import type { EmailMessage, EmailSender } from "./adapter.js";

export function consoleSender(env: AppEnv): EmailSender {
  if (env.nodeEnv === "production" && !env.allowConsoleEmail) {
    throw new Error(
      "Refusing the console email sender in production: a sign-in link would " +
        "be written to the log. Set EMAIL_ENDPOINT, EMAIL_TOKEN and EMAIL_FROM, " +
        "or EMAIL_CONSOLE=true to accept that.",
    );
  }

  return {
    send(message: EmailMessage): Promise<void> {
      console.info(
        `[email] to=${message.to} subject=${message.subject}\n${message.text}`,
      );
      return Promise.resolve();
    },
  };
}
