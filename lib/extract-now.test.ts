import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClaimedJob, JobReport } from "@/lib/queue";

const mocks = vi.hoisted(() => ({
  scheduled: [] as (() => Promise<void>)[],
  client: { tag: "service-role client" },
  claimItemJob: vi.fn(),
  processJob: vi.fn(),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => mocks.scheduled.push(callback),
}));
vi.mock("@sentry/nextjs", () => ({
  captureMessage: mocks.captureMessage,
  captureException: mocks.captureException,
  flush: async () => true,
}));
vi.mock("@/lib/db/service", () => ({
  createServiceSupabase: () => mocks.client,
}));
vi.mock("@/lib/queue", () => ({
  claimItemJob: mocks.claimItemJob,
  processJob: mocks.processJob,
}));

import { extractSoon } from "@/lib/extract-now";

const job: ClaimedJob = {
  job_id: 7,
  item_id: "item-1",
  user_id: "owner-1",
  url: "https://example.com/a",
  url_hash: "a".repeat(64),
  attempts: 1,
  max_attempts: 3,
};

const report = (over: Partial<JobReport>): JobReport => ({
  jobId: 7,
  itemId: "item-1",
  userId: "owner-1",
  url: job.url,
  attempts: 1,
  outcome: "done",
  reason: null,
  note: null,
  runAfter: null,
  warning: null,
  ...over,
});

beforeEach(() => {
  mocks.scheduled = [];
  vi.clearAllMocks();
});

describe("extractSoon", () => {
  it("does nothing until the response has gone", () => {
    extractSoon("item-1", "owner-1", "api/save");
    expect(mocks.scheduled).toHaveLength(1);
    expect(mocks.claimItemJob).not.toHaveBeenCalled();
  });

  it("claims this item's job for its owner with the service client, then runs it", async () => {
    mocks.claimItemJob.mockResolvedValue(job);
    mocks.processJob.mockResolvedValue(report({}));
    extractSoon("item-1", "owner-1", "api/save");
    await mocks.scheduled[0]();
    expect(mocks.claimItemJob).toHaveBeenCalledWith(
      mocks.client,
      "item-1",
      "owner-1",
      false,
    );
    expect(mocks.processJob).toHaveBeenCalledWith(mocks.client, job, {
      page: undefined,
    });
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });

  it("hands a page the reader sent to the job instead of fetching", async () => {
    mocks.claimItemJob.mockResolvedValue(job);
    mocks.processJob.mockResolvedValue(report({}));
    const page = { url: job.url, html: "<html></html>" };
    extractSoon("item-1", "owner-1", "api/save", page);
    await mocks.scheduled[0]();
    // A sent page is not held back by a fetch backoff (0009).
    expect(mocks.claimItemJob).toHaveBeenCalledWith(
      mocks.client,
      "item-1",
      "owner-1",
      true,
    );
    expect(mocks.processJob).toHaveBeenCalledWith(mocks.client, job, { page });
  });

  it("runs nothing when the claim comes back empty", async () => {
    mocks.claimItemJob.mockResolvedValue(null);
    extractSoon("item-1", "owner-1", "api/save");
    await mocks.scheduled[0]();
    expect(mocks.processJob).not.toHaveBeenCalled();
  });

  it("reports a failure with its URL and code, and a claim error as an exception", async () => {
    mocks.claimItemJob.mockResolvedValue(job);
    mocks.processJob.mockResolvedValue(
      report({ outcome: "failed", reason: "blocked_url" }),
    );
    extractSoon("item-1", "owner-1", "api/save");
    await mocks.scheduled[0]();
    expect(mocks.captureMessage).toHaveBeenCalledWith(
      "save: blocked_url",
      expect.objectContaining({ level: "warning" }),
    );

    mocks.claimItemJob.mockRejectedValue(new Error("database down"));
    extractSoon("item-1", "owner-1", "api/save");
    await expect(mocks.scheduled[1]()).resolves.toBeUndefined();
    expect(mocks.captureException).toHaveBeenCalled();
  });
});
