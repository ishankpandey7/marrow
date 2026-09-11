import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSaveController, type Feedback, type SaveState } from "../core";

function newToken() {
  return `mrx_${randomBytes(32).toString("base64url")}`;
}
function accepted(alreadySaved = false) {
  return Response.json(
    {
      item: {
        id: "item-id",
        url: "https://example.com/article",
        status: "pending",
      },
      alreadySaved,
    },
    { status: alreadySaved ? 200 : 201 },
  );
}
function setup() {
  let saved: SaveState | undefined;
  let time = Date.UTC(2026, 8, 11);
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => accepted());
  const show = vi
    .fn<(feedback: Feedback) => Promise<void>>()
    .mockResolvedValue();
  const schedule = vi.fn<() => Promise<void>>().mockResolvedValue();
  const dependencies = {
    now: () => time,
    fetch: request,
    read: async () => structuredClone(saved),
    write: async (value: SaveState) => {
      saved = structuredClone(value);
    },
    show,
    schedule,
    endpoint: "https://marrow-bice.vercel.app/api/save",
  };
  return {
    controller: createSaveController(dependencies),
    restart: () => createSaveController(dependencies),
    request,
    show,
    schedule,
    stored: () => saved,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
    dependencies,
  };
}

describe("save-only extension background", () => {
  it("does not send a request without a token and shows actionable toolbar feedback", async () => {
    const fixture = setup();
    const result = await fixture.controller.save("https://example.com/article");
    expect(result.feedback.status).toBe("auth");
    expect(fixture.show).toHaveBeenLastCalledWith(result.feedback);
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it("persists the credential but never returns it to the options page", async () => {
    const fixture = setup();
    const token = newToken();
    const result = await fixture.controller.configure(` ${token} `);
    expect(fixture.stored()?.token).toBe(token);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(await fixture.controller.status())).not.toContain(
      token,
    );
  });

  it("rejects a malformed token without replacing a working configuration", async () => {
    const fixture = setup();
    const token = newToken();
    await fixture.controller.configure(token);
    await expect(fixture.controller.configure("not a token")).rejects.toThrow(
      "complete save token",
    );
    expect(fixture.stored()?.token).toBe(token);
  });

  it("uses only the fixed save endpoint, bearer auth, no cookies, and no redirects", async () => {
    const fixture = setup();
    const token = newToken();
    await fixture.controller.configure(token);
    const result = await fixture.controller.save(
      "https://example.com/article?utm_source=extension#paragraph",
    );
    expect(fixture.request).toHaveBeenCalledWith(
      fixture.dependencies.endpoint,
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: "https://example.com/article?utm_source=extension#paragraph",
        }),
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(result.feedback.status).toBe("saved");
    expect(result.queued).toBe(0);
    expect(fixture.show).toHaveBeenLastCalledWith(result.feedback);
  });

  it("sends re-saves to the same server and reports alreadySaved from its response", async () => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    await fixture.controller.save(
      "https://example.com/article?utm_source=extension",
    );
    fixture.request.mockResolvedValueOnce(accepted(true));
    const result = await fixture.controller.save("https://example.com/article");
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(result.feedback.status).toBe("already");
    expect(result.feedback.message).toContain("Already saved");
    expect(result.feedback.message).toContain("Reading state kept");
    expect(fixture.stored()?.queue).toEqual([]);
  });

  it.each([
    undefined,
    "chrome://settings",
    "about:config",
    "file:///secret.txt",
    "javascript:alert(1)",
    "https://user:password@example.com/",
  ])("rejects unsupported tab or link %s before fetch", async (url) => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    expect((await fixture.controller.save(url)).feedback.status).toBe("error");
    expect(fixture.request).not.toHaveBeenCalled();
  });

  it("writes the offline intent before fetch and retries after a background restart", async () => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    fixture.request.mockImplementationOnce(async () => {
      expect(fixture.stored()?.queue).toHaveLength(1);
      expect(fixture.stored()?.queue[0].attempts).toBe(1);
      throw new TypeError("Offline");
    });
    expect(
      (await fixture.controller.save("https://example.com/article")).feedback
        .status,
    ).toBe("queued");
    const restarted = fixture.restart();
    await restarted.resume();
    expect(fixture.request).toHaveBeenCalledTimes(1);
    fixture.advance(60_000);
    expect((await restarted.resume()).feedback.status).toBe("saved");
    expect(fixture.request).toHaveBeenCalledTimes(2);
    expect(fixture.stored()?.queue).toEqual([]);
  });

  it("does not enqueue repeated offline clicks on the exact same URL", async () => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    fixture.request.mockRejectedValue(new TypeError("Offline"));
    await Promise.all([
      fixture.controller.save("https://example.com/article"),
      fixture.controller.save("https://example.com/article"),
    ]);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(fixture.stored()?.queue).toHaveLength(1);
  });

  it("honors a per-user Retry-After for every pending URL", async () => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    fixture.request.mockRejectedValueOnce(new TypeError("Offline"));
    await fixture.controller.save("https://example.com/one");
    fixture.request.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "Retry-After": "3600" } }),
    );
    expect(
      (await fixture.controller.save("https://example.com/two")).feedback
        .message,
    ).toContain("limit");
    fixture.advance(3_599_000);
    await fixture.restart().resume();
    expect(fixture.request).toHaveBeenCalledTimes(2);
    fixture.advance(1_000);
    await fixture.restart().resume();
    expect(fixture.request).toHaveBeenCalledTimes(3);
    expect(fixture.stored()?.queue).toHaveLength(1);
  });

  it("accepts an HTTP date Retry-After", async () => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    const next = new Date(fixture.dependencies.now() + 120_000).toUTCString();
    fixture.request.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "Retry-After": next } }),
    );
    await fixture.controller.save("https://example.com/article");
    expect(fixture.stored()?.queue[0].nextAt).toBe(
      fixture.dependencies.now() + 120_000,
    );
  });

  it("backs off transient server errors and retries automatically", async () => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    fixture.request.mockResolvedValue(new Response(null, { status: 503 }));
    await fixture.controller.save("https://example.com/article");
    fixture.advance(60_000);
    await fixture.controller.resume();
    expect(fixture.stored()?.queue[0].nextAt).toBe(
      fixture.dependencies.now() + 120_000,
    );
  });

  it.each([401, 403])(
    "clears revoked credentials and their queued saves after %s",
    async (status) => {
      const fixture = setup();
      await fixture.controller.configure(newToken());
      fixture.request.mockRejectedValueOnce(new TypeError("Offline"));
      await fixture.controller.save("https://example.com/one");
      fixture.request.mockResolvedValueOnce(new Response(null, { status }));
      const result = await fixture.controller.save("https://example.com/two");
      expect(result.feedback.status).toBe("auth");
      expect(result.configured).toBe(false);
      expect(result.queued).toBe(0);
      expect(fixture.stored()?.token).toBe(null);
    },
  );

  it("discards old pending saves when switching tokens but preserves them for the same token", async () => {
    const fixture = setup();
    const first = newToken();
    await fixture.controller.configure(first);
    fixture.request.mockRejectedValueOnce(new TypeError("Offline"));
    await fixture.controller.save("https://example.com/article");
    expect((await fixture.controller.configure(first)).queued).toBe(1);
    expect((await fixture.controller.configure(newToken())).queued).toBe(0);
    fixture.advance(60_000);
    await fixture.controller.resume();
    expect(fixture.request).toHaveBeenCalledTimes(1);
  });

  it("serializes token replacement behind an in-flight request without restoring old state", async () => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    let rejectRequest: ((error: Error) => void) | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    fixture.request.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject;
          resolveStarted?.();
        }),
    );
    const saving = fixture.controller.save("https://example.com/article");
    await started;
    const replacement = newToken();
    const configuring = fixture.controller.configure(replacement);
    rejectRequest?.(new Error("Offline"));
    await saving;
    await configuring;
    expect(fixture.stored()?.token).toBe(replacement);
    expect(fixture.stored()?.queue).toEqual([]);
  });

  it("reports a permanent failure without keeping a doomed retry", async () => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    fixture.request.mockResolvedValueOnce(new Response(null, { status: 400 }));
    const result = await fixture.controller.save("https://example.com/article");
    expect(result.feedback.status).toBe("error");
    expect(result.queued).toBe(0);
  });

  it.each(["not JSON", JSON.stringify({ item: { id: "id" } })])(
    "retries an ambiguous successful response without falsely showing success",
    async (body) => {
      const fixture = setup();
      await fixture.controller.configure(newToken());
      fixture.request.mockResolvedValueOnce(
        new Response(body, { status: 201 }),
      );
      expect(
        (await fixture.controller.save("https://example.com/article")).feedback
          .status,
      ).toBe("queued");
      expect(fixture.stored()?.queue).toHaveLength(1);
      fixture.advance(60_000);
      fixture.request.mockResolvedValueOnce(accepted(true));
      expect((await fixture.restart().resume()).feedback.status).toBe(
        "already",
      );
    },
  );

  it("caps the durable queue without silently dropping an accepted intent", async () => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    fixture.request.mockRejectedValue(new Error("Offline"));
    for (let index = 0; index < 100; index++)
      await fixture.controller.save(`https://example.com/${index}`);
    const result = await fixture.controller.save(
      "https://example.com/overflow",
    );
    expect(result.feedback.status).toBe("error");
    expect(result.queued).toBe(100);
    expect(fixture.request).toHaveBeenCalledTimes(100);
  });

  it("does not send a request when persisting the intent fails", async () => {
    const fixture = setup();
    await fixture.controller.configure(newToken());
    const broken = createSaveController({
      ...fixture.dependencies,
      write: async () => {
        throw new Error("Storage failed");
      },
    });
    await expect(broken.save("https://example.com/article")).rejects.toThrow(
      "Storage failed",
    );
    expect(fixture.request).not.toHaveBeenCalled();
  });
});
