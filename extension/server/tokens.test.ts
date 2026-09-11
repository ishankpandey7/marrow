import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  extensionTokenSecret,
  findExtensionTokenOwner,
  hashExtensionToken,
  isExtensionToken,
  issueExtensionToken,
  TOKEN_METADATA,
} from "./tokens";

function credentials() {
  return {
    secret: randomBytes(32).toString("hex"),
    token: `mrx_${randomBytes(32).toString("base64url")}`,
    userId: randomUUID(),
  };
}

interface CapturedRequest {
  url: URL;
  method: string;
  body: string;
}

function database(responseBody: unknown = [], status = 200) {
  const requests: CapturedRequest[] = [];
  const client = createClient(
    "https://database.invalid",
    randomBytes(32).toString("base64url"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          requests.push({
            url: new URL(request.url),
            method: request.method,
            body: await request.text(),
          });
          return new Response(JSON.stringify(responseBody), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    },
  );
  return { client, requests };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extension token secret", () => {
  it("reads the existing server variable only when asked", () => {
    const { secret } = credentials();
    vi.stubEnv("EXTENSION_TOKEN_SECRET", secret);
    expect(extensionTokenSecret()).toBe(secret);
  });

  it.each([undefined, "", randomBytes(8).toString("hex")])(
    "rejects a missing or undersized secret (%s)",
    (value) => {
      vi.stubEnv("EXTENSION_TOKEN_SECRET", value);
      expect(() => extensionTokenSecret()).toThrow(/EXTENSION_TOKEN_SECRET/);
    },
  );
});

describe("extension token hashing", () => {
  it("uses the secret and domain-separated HMAC without retaining plaintext", () => {
    const { token, secret } = credentials();
    const expected = createHmac("sha256", secret)
      .update("extension-save:v1:")
      .update(token)
      .digest("hex");

    expect(hashExtensionToken(token, secret)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(expected).not.toContain(token);
    expect(hashExtensionToken(token, credentials().secret)).not.toBe(expected);
  });

  it("accepts only the complete opaque token format", () => {
    const { token } = credentials();
    expect(isExtensionToken(token)).toBe(true);
    for (const invalid of [
      "",
      token.slice(1),
      token.slice(0, -1),
      `${token}x`,
      `${token}\n`,
      ` ${token}`,
      `Bearer ${token}`,
      `${token.slice(0, -1)}=`,
      token.replace("mrx_", "jwt_"),
    ]) {
      expect(isExtensionToken(invalid)).toBe(false);
    }
  });
});

describe("issuing an extension token", () => {
  it("returns plaintext once while inserting only its hash and authenticated owner", async () => {
    const { secret, userId } = credentials();
    const { client, requests } = database(null, 201);

    const token = await issueExtensionToken(
      client,
      userId,
      "Firefox laptop",
      secret,
    );

    expect(isExtensionToken(token)).toBe(true);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.method).toBe("POST");
    expect(request.url.pathname).toBe("/rest/v1/extension_tokens");
    expect(JSON.parse(request.body)).toEqual({
      user_id: userId,
      name: "Firefox laptop",
      token_hash: hashExtensionToken(token, secret),
    });
    expect(request.body).not.toContain(token);
    expect(request.body).not.toContain(secret);
    expect(request.url.href).not.toContain(token);
  });

  it("issues a different credential for each browser", async () => {
    const { secret, userId } = credentials();
    const { client } = database(null, 201);
    const first = await issueExtensionToken(client, userId, "Chrome", secret);
    const second = await issueExtensionToken(client, userId, "Firefox", secret);
    expect(first).not.toBe(second);
  });

  it("does not return a credential when storage fails", async () => {
    const { secret, userId } = credentials();
    const { client } = database(
      { message: "Database unavailable", code: "XX000" },
      500,
    );
    await expect(
      issueExtensionToken(client, userId, "Browser", secret),
    ).rejects.toThrow("Could not create the extension token.");
  });

  it("settings metadata excludes both the token and its hash", () => {
    expect(TOKEN_METADATA.split(",").map((column) => column.trim())).toEqual([
      "id",
      "name",
      "created_at",
      "revoked_at",
    ]);
  });
});

describe("resolving an extension token owner", () => {
  it("uses only the matching active hash and returns its stored owner", async () => {
    const { token, secret, userId } = credentials();
    const { client, requests } = database([{ user_id: userId }]);

    await expect(findExtensionTokenOwner(client, token, secret)).resolves.toBe(
      userId,
    );

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request.method).toBe("GET");
    expect(request.url.pathname).toBe("/rest/v1/extension_tokens");
    expect(request.url.searchParams.get("select")).toBe("user_id");
    expect(request.url.searchParams.get("token_hash")).toBe(
      `eq.${hashExtensionToken(token, secret)}`,
    );
    expect(request.url.searchParams.get("revoked_at")).toBe("is.null");
    expect(request.url.searchParams.has("user_id")).toBe(false);
    expect(request.url.href).not.toContain(token);
    expect(request.url.href).not.toContain(secret);
    expect(request.body).toBe("");
  });

  it("rejects malformed tokens before making any database request", async () => {
    const { token, secret } = credentials();
    const { client, requests } = database();
    for (const invalid of [
      "",
      "mrx_",
      `${token}x`,
      `${token}\n`,
      `Bearer ${token}`,
    ]) {
      await expect(
        findExtensionTokenOwner(client, invalid, secret),
      ).resolves.toBeNull();
    }
    expect(requests).toHaveLength(0);
  });

  it("returns no owner when an unknown or revoked hash is absent from active rows", async () => {
    const { token, secret } = credentials();
    const { client } = database([]);
    await expect(
      findExtensionTokenOwner(client, token, secret),
    ).resolves.toBeNull();
  });

  it.each([{}, { user_id: null }, { user_id: 123 }])(
    "does not trust a malformed database owner (%j)",
    async (row) => {
      const { token, secret } = credentials();
      const { client } = database([row]);
      await expect(
        findExtensionTokenOwner(client, token, secret),
      ).resolves.toBeNull();
    },
  );

  it("fails closed with an opaque error when token lookup fails", async () => {
    const { token, secret } = credentials();
    const { client } = database(
      { message: "Private database details", code: "XX000" },
      500,
    );
    await expect(
      findExtensionTokenOwner(client, token, secret),
    ).rejects.toThrow("Could not verify the extension token.");
  });

  it("does not choose an owner when lookup unexpectedly matches multiple rows", async () => {
    const { token, secret } = credentials();
    const { client } = database([
      { user_id: randomUUID() },
      { user_id: randomUUID() },
    ]);
    await expect(
      findExtensionTokenOwner(client, token, secret),
    ).rejects.toThrow("Could not verify the extension token.");
  });
});
