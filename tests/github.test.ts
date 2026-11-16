import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubClient } from "../pipeline/lib/github";

const client = () => createGitHubClient(undefined, { retryDelayMs: 0 });
const read = () => client().getFileText("acme/skills", "main", "SKILL.md");
const stubFetch = (...results: Array<Response | Error>) => {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = results.shift();
    if (!next) throw new Error("unexpected extra fetch call");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFileText", () => {
  it("encodes the ref and the path in the raw URL", async () => {
    const fetchMock = stubFetch(new Response("ok", { status: 200 }));
    await client().getFileText("acme/skills", "feature/x#1", "my skills/a b/SKILL.md");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://raw.githubusercontent.com/acme/skills/feature/x%231/my%20skills/a%20b/SKILL.md",
    );
  });

  it("returns the text on 200", async () => {
    stubFetch(new Response("hello", { status: 200 }));
    await expect(read()).resolves.toBe("hello");
  });

  it("retries on 503 then succeeds", async () => {
    const fetchMock = stubFetch(new Response("", { status: 503 }), new Response("ok", { status: 200 }));
    await expect(read()).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 404", async () => {
    const fetchMock = stubFetch(new Response("", { status: 404 }));
    await expect(read()).rejects.toThrow("failed with status 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries when fetch throws, then succeeds", async () => {
    const fetchMock = stubFetch(new Error("socket hang up"), new Response("ok", { status: 200 }));
    await expect(read()).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries when reading the body fails, then succeeds", async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("reset"));
        },
      }),
      { status: 200 },
    );
    const fetchMock = stubFetch(broken, new Response("ok", { status: 200 }));
    await expect(read()).resolves.toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after three failed body reads and names the URL", async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("reset"));
          },
        }),
        { status: 200 },
      );
    const fetchMock = stubFetch(broken(), broken(), broken());
    await expect(read()).rejects.toThrow("https://raw.githubusercontent.com/acme/skills/main/SKILL.md");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after three thrown errors and names the URL", async () => {
    const fetchMock = stubFetch(new Error("boom"), new Error("boom"), new Error("boom"));
    await expect(read()).rejects.toThrow("https://raw.githubusercontent.com/acme/skills/main/SKILL.md");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("refuses a file whose content-length is above the cap without retrying", async () => {
    const fetchMock = stubFetch(
      new Response("small", { status: 200, headers: { "content-length": "1000001" } }),
    );
    await expect(read()).rejects.toThrow("is larger than 1000000 bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a file whose text is above the cap when no length is declared", async () => {
    const fetchMock = stubFetch(new Response("x".repeat(1_000_001), { status: 200 }));
    await expect(read()).rejects.toThrow("is larger than 1000000 bytes");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getRepo", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("returns null on 404 after a single call", async () => {
    const fetchMock = stubFetch(json(404, { message: "Not Found" }));
    await expect(client().getRepo("ghost/deleted")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null on a 403 that carries a block field", async () => {
    const fetchMock = stubFetch(
      json(403, { message: "Repository access blocked", block: { reason: "tos" } }),
    );
    await expect(client().getRepo("acme/blocked")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws on any other 403 without retrying", async () => {
    const fetchMock = stubFetch(json(403, { message: "Forbidden" }));
    await expect(client().getRepo("acme/skills")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 then returns the mapped metadata", async () => {
    const fetchMock = stubFetch(
      json(503, { message: "Service Unavailable" }),
      json(200, {
        full_name: "acme/skills",
        html_url: "https://github.com/acme/skills",
        description: "Skills",
        stargazers_count: 120,
        forks_count: 7,
        license: { spdx_id: "MIT" },
        pushed_at: "2026-11-01T00:00:00Z",
        default_branch: "main",
        archived: false,
      }),
    );
    await expect(client().getRepo("acme/skills")).resolves.toEqual({
      fullName: "acme/skills",
      url: "https://github.com/acme/skills",
      description: "Skills",
      stars: 120,
      forks: 7,
      license: "MIT",
      pushedAt: "2026-11-01T00:00:00Z",
      defaultBranch: "main",
      archived: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("getFileBytes", () => {
  it("returns the raw bytes, a leading BOM and CRLF line endings included", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x4d, 0x49, 0x54, 0x0d, 0x0a]);
    const fetchMock = stubFetch(new Response(bytes, { status: 200 }));
    const result = await client().getFileBytes("acme/skills", "main", "skills/a b/LICENSE");
    expect([...result]).toEqual([...bytes]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://raw.githubusercontent.com/acme/skills/main/skills/a%20b/LICENSE",
    );
  });

  it("retries on 503 then succeeds", async () => {
    const fetchMock = stubFetch(new Response("", { status: 503 }), new Response("ok", { status: 200 }));
    const result = await client().getFileBytes("acme/skills", "main", "LICENSE");
    expect(new TextDecoder().decode(result)).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses a file above the cap", async () => {
    stubFetch(new Response(new Uint8Array(1_000_001), { status: 200 }));
    await expect(client().getFileBytes("acme/skills", "main", "LICENSE")).rejects.toThrow("is larger than");
  });
});

describe("getTree", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("keeps each entry's mode and returns the tree id", async () => {
    stubFetch(
      json(200, {
        sha: "f".repeat(40),
        truncated: false,
        tree: [
          { path: "LICENSE", type: "blob", sha: "a".repeat(40), mode: "120000" },
          { path: "skills", type: "tree", sha: "b".repeat(40), mode: "040000" },
        ],
      }),
    );
    await expect(client().getTree("acme/skills", "main")).resolves.toEqual({
      entries: [
        { path: "LICENSE", type: "blob", sha: "a".repeat(40), mode: "120000" },
        { path: "skills", type: "tree", sha: "b".repeat(40), mode: "040000" },
      ],
      truncated: false,
      sha: "f".repeat(40),
    });
  });
});
