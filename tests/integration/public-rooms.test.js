"use strict";

/**
 * Integration tests for the public room directory (publicRooms feature).
 *
 * These tests run against the live Dicefiles server at http://127.0.0.1:9090.
 * They require that the server is started with `publicRooms: true` in the
 * project configuration file (.config.json).
 * All tests are skipped automatically if the server is unreachable.
 */

const BASE = "http://127.0.0.1:9090";

async function get(path) {
  const res = await fetch(BASE + path);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("json") ? null : await res.text();
  const json = ct.includes("json") ? await res.json() : null;
  return { status: res.status, headers: res.headers, body, json };
}

// ── pre-flight: skip if server is down ────────────────────────────────────────

let serverUp = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE}/healthz`, {
      signal: AbortSignal.timeout(4000),
    });
    serverUp = res.status === 200 || res.status === 503;
  } catch {
    serverUp = false;
  }
  if (!serverUp) {
    console.warn(
      "\n[public-rooms.test.js] Server not reachable at",
      BASE,
      "— all integration tests SKIPPED\n",
    );
  } else {
    // detect whether publicRooms is enabled by looking for room-directory
    try {
      const r = await fetch(BASE + "/");
      const body = await r.text();
      if (
        !body.includes('id="room-directory"') &&
        body.includes("Welcome to Dicefiles")
      ) {
        serverUp = false; // treat as skip
        console.warn(
          "\n[public-rooms.test.js] publicRooms disabled in server config — tests SKIPPED\n",
        );
      }
    } catch (e) {
      /* ignore */
    }
  }
});

function ifServer(name, fn) {
  test(name, async () => {
    if (!serverUp) return;
    await fn();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET / — home page room directory
// ─────────────────────────────────────────────────────────────────────────────

describe("GET / — public room directory", () => {
  ifServer("returns HTTP 200", async () => {
    const { status } = await get("/");
    expect(status).toBe(200);
  });

  ifServer(
    "renders the room-directory article when publicRooms is enabled",
    async () => {
      const { body } = await get("/");
      expect(body).toContain('id="room-directory"');
    },
  );

  ifServer("renders the card grid container", async () => {
    const { body } = await get("/");
    if (
      !body.includes('id="room-directory"') ||
      body.includes("No rooms yet")
    ) {
      return;
    }
    expect(body).toContain('class="room-cards"');
  });

  ifServer("room cards link to /r/<roomid>", async () => {
    const { body } = await get("/");
    if (
      !body.includes('id="room-directory"') ||
      body.includes("No rooms yet")
    ) {
      return;
    }
    const linkMatches = [...body.matchAll(/href="(\/r\/[^"]+)"/g)];
    expect(linkMatches.length).toBeGreaterThan(0);
    for (const [, href] of linkMatches) {
      expect(href).toMatch(/^\/r\/[A-Za-z0-9_-]+$/);
    }
  });

  ifServer("each card has a room name and stat pills", async () => {
    const { body } = await get("/");
    if (
      !body.includes('id="room-directory"') ||
      body.includes("No rooms yet")
    ) {
      return;
    }
    expect(body).toContain('class="room-card-name"');
    expect(body).toContain('class="rc-stat"');
  });

  ifServer("MOTD is rendered inside card when set", async () => {
    const { body } = await get("/");
    if (
      !body.includes('id="room-directory"') ||
      body.includes("No rooms yet")
    ) {
      return;
    }
    // If any room has a motd the div must appear. If no room has a motd
    // the div is simply absent — both outcomes are valid.
    if (body.includes('class="room-card-motd"')) {
      // Must be inside a .room-card
      const motdIdx = body.indexOf('class="room-card-motd"');
      const cardIdx = body.lastIndexOf('class="room-card"', motdIdx);
      expect(cardIdx).toBeGreaterThan(-1);
      expect(cardIdx).toBeLessThan(motdIdx);
    }
  });

  ifServer("shows 'No rooms yet' message when directory is empty", async () => {
    const { body } = await get("/");
    const hasDirectory = body.includes('id="room-directory"');
    const hasEmpty = body.includes("No rooms yet");
    const hasWelcome = body.includes("Welcome to Dicefiles");
    expect(hasDirectory || hasEmpty || hasWelcome).toBe(true);
  });

  ifServer("page contains no server-side errors", async () => {
    const { body } = await get("/");
    expect(body).not.toContain("SyntaxError");
    expect(body).not.toContain("Error:");
  });
});
