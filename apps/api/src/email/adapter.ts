// The email seam. One interface, two implementations, chosen by what is
// configured — the same adapter shape as storage and the database, so a
// self-hoster swaps a transactional provider without touching a caller.

import type { AppEnv } from "../env.js";
import { consoleSender } from "./console.js";
import { httpSender } from "./http.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/**
 * Credentials win; otherwise the console, which refuses to exist in
 * production. The failure is at boot and loud rather than a sign-in email
 * that silently goes to a log nobody reads.
 */
export function emailSender(env: AppEnv): EmailSender {
  return env.email ? httpSender(env.email) : consoleSender(env);
}
