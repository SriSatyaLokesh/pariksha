import { describe, expect, it } from "vitest";
import { sqliteClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import {
  createPasswordUser,
  getUserCredentialsByEmail,
  getUserCredentialsById,
  setUserPassword,
  setUserTotp,
} from "../../src/repo/identity.js";

describe("Password and TOTP credentials (Phase 10, S-01, S-02)", () => {
  it("creates a password user, retrieves credentials, updates password and TOTP", async () => {
    const db = sqliteClient(":memory:");
    await migrate(db);

    const now = Date.now();
    const userId = await createPasswordUser(db, {
      email: "organizer@institution.edu",
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$fakehash",
      now,
    });

    expect(userId).toMatch(/^usr_/);

    const creds = await getUserCredentialsByEmail(db, "organizer@institution.edu");
    expect(creds).toEqual({
      id: userId,
      email: "organizer@institution.edu",
      authProvider: "password",
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$fakehash",
      totpSecret: null,
      totpEnabled: false,
    });

    const byId = await getUserCredentialsById(db, userId);
    expect(byId).toEqual(creds);

    // Update password
    const newHash = "$argon2id$v=19$m=65536,t=3,p=4$updatedhash";
    await setUserPassword(db, userId, newHash);
    const updated = await getUserCredentialsById(db, userId);
    expect(updated?.passwordHash).toBe(newHash);

    // Set and enable TOTP
    await setUserTotp(db, userId, "JBSWY3DPEHPK3PXP", true);
    const withTotp = await getUserCredentialsById(db, userId);
    expect(withTotp?.totpSecret).toBe("JBSWY3DPEHPK3PXP");
    expect(withTotp?.totpEnabled).toBe(true);

    // Disable TOTP
    await setUserTotp(db, userId, null, false);
    const disabledTotp = await getUserCredentialsById(db, userId);
    expect(disabledTotp?.totpSecret).toBe(null);
    expect(disabledTotp?.totpEnabled).toBe(false);
  });
});
