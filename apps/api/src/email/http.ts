// One HTTP sender for every transactional-email provider.
//
// No SDK: each vendor's client is a dependency, a bundle and an API that
// drifts, in exchange for a POST with a bearer token. Providers whose JSON
// field names differ from these are reached with the same endpoint behind a
// three-line reverse proxy, which is cheaper than an adapter per vendor.

import type { EmailConfig } from "../env.js";
import { ApiError } from "../errors.js";
import type { EmailMessage, EmailSender } from "./adapter.js";

export function httpSender(
  config: EmailConfig,
  // Injected so a test never reaches a provider; the default is the runtime's
  // own, which is what both Workers and Node use.
  http: typeof globalThis.fetch = globalThis.fetch,
): EmailSender {
  return {
    async send(message: EmailMessage): Promise<void> {
      const response = await http(config.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from: config.from, ...message }),
      });
      if (!response.ok) {
        // The body is not read: a provider's error text can quote the
        // message, and the message holds a live sign-in link.
        throw new ApiError(
          502,
          "email_send_failed",
          `The email provider answered ${response.status}`,
        );
      }
    },
  };
}
