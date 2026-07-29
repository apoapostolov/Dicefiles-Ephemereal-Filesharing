"use strict";

/**
 * View render tests — verify that every EJS template in views/ renders without
 * throwing an error when given a plausible context, and that the resulting HTML
 * contains the expected structural markers.
 *
 * These tests run EJS directly — no Express server is required, no Redis.
 */

const path = require("path");
const ejs = require("ejs");

const VIEWS = path.join(__dirname, "../../views");
const V = "test1234"; // fake asset version

/** Shared context available in every view */
const BASE_CTX = {
  NAME: "TestSite",
  MOTTO: "Testing Dicefiles",
  v: V,
  token: "test-csrf-token",
};

/** Render a view by filename and merge extra context */
async function render(view, extra = {}) {
  const ctx = Object.assign({}, BASE_CTX, extra);
  return ejs.renderFile(path.join(VIEWS, view), ctx, {
    views: VIEWS,
    // Silence include-path warnings from ejs
    rmWhitespace: false,
  });
}

function makeStatus(overrides = {}) {
  return Object.assign(
    {
      schemaVersion: 1,
      generatedAt: "2026-07-28T12:00:00.000Z",
      service: {
        name: "TestSite",
        release: "1.4.2",
        status: "operational",
        uptimeSec: 3600,
      },
      capacity: {
        disk: {
          totalBytes: 1000000,
          freeBytes: 400000,
          usedBytes: 600000,
          usedPercent: 60,
        },
        uploads: { files: 12, logicalBytes: 300000 },
      },
      community: { rooms: 4, usersOnline: 7, registeredUsers: 20 },
      activity: {
        since: "2026-07-28T10:00:00.000Z",
        totals: {
          uploadsCreated: 14,
          uploadsBytes: 750000,
          uploadsDeleted: 2,
          downloadsServed: 30,
          downloadsBytes: 900000,
          requestsCreated: 3,
          requestsFulfilled: 1,
          previewFailures: 0,
        },
      },
      requests: {
        current: {
          total: 5,
          open: 2,
          fulfilled: 3,
          activeClaims: 1,
          fulfillmentPercent: 60,
          medianFulfillmentSec: 1800,
          oldestOpenSec: 7200,
        },
        last24h: { opened: 4, fulfilled: 3 },
        timeline: {
          intervalSec: 7200,
          windowSec: 432000,
          points: [
            {
              at: "2026-07-28T10:00:00.000Z",
              unfulfilled: 2,
              fulfilled: 3,
            },
          ],
        },
      },
      insights: {
        averageDownloadBytes: 30000,
        downloadsPerUpload: 2.1,
        filesPerRoom: 3,
        previewFailures: 0,
      },
      pipeline: {
        status: "operational",
        pending: 0,
        active: 1,
        lastFailureAt: null,
      },
      components: [
        {
          id: "database",
          label: "Realtime database",
          status: "operational",
          latencyMs: 2,
        },
      ],
      history: {
        intervalSec: 300,
        windowSec: 86400,
        maxPoints: 288,
        points: [
          {
            at: "2026-07-28T12:00:00.000Z",
            storageBytes: 300000,
            files: 12,
            rooms: 4,
            usersOnline: 7,
            downloadsBytes: 900000,
            downloadsServed: 30,
          },
        ],
        traffic: {
          intervalSec: 7200,
          windowSec: 432000,
          points: [
            {
              at: "2026-07-28T10:00:00.000Z",
              uploadedBytes: 750000,
              downloadedBytes: 900000,
            },
          ],
        },
      },
      privacy: { aggregationOnly: true, excluded: [] },
    },
    overrides,
  );
}

// ── dummy data factories ────────────────────────────────────────────────────

function makeUser(overrides = {}) {
  return Object.assign(
    {
      name: "TestUser",
      account: "testuser",
      role: "user",
      email: "",
      pubmail: false,
      message: "",
      gravatar: "",
      twofactor: false,
    },
    overrides,
  );
}

function makeAchievements(overrides = {}) {
  return Object.assign(
    {
      files: 0,
      uploaded: 0,
      downloaded: 0,
      unlocked: 0,
      total: 0,
      all: [],
      unlockedList: [],
      lockedList: [],
      filesOnly: [],
      bytesOnly: [],
      downloadsOnly: [],
      requestsOnly: [],
      requestsCreatedOnly: [],
    },
    overrides,
  );
}

function makeInfo(overrides = {}) {
  return Object.assign(
    {
      name: "TestUser",
      role: "user",
      email: undefined,
      gravatar: undefined,
      uploaded: "0 B",
      files: "0",
      downloaded: "0 B",
      achievements: makeAchievements(),
      messageHtml: "",
      canEditMessage: false,
    },
    overrides,
  );
}

function makeRecord(overrides = {}) {
  return Object.assign(
    {
      id: "rec001",
      roomid: "testroom",
      issued: Date.now(),
      text: "Test ban reason",
      mod: { name: "ModUser" },
      revert: null,
      ips: null,
      accounts: [],
      files: [],
    },
    overrides,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Views that need minimal context
// ─────────────────────────────────────────────────────────────────────────────

test("index.ejs renders without error", async () => {
  const html = await render("index.ejs");
  expect(html).toContain("TestSite");
  expect(html).toContain("<body");
  expect(html).toContain("Welcome to Dicefiles");
});

test("room.ejs renders without error", async () => {
  const html = await render("room.ejs");
  expect(html).toContain('<body id="room"');
  expect(html).toContain("TestSite");
  // Key UI elements present
  expect(html).toContain('id="filter"');
  expect(html).toContain('id="menu"');
  expect(html).toContain('id="roomopts-rule-user"');
  expect(html).toContain("Rule syntax");
  expect(html).toContain("ask an AI to convert your");
  // Continuity/discovery chrome
  expect(html).toContain('id="continuity"');
  expect(html).toContain('id="continuity-resume"');
  expect(html).toContain('id="continuity-digest-control"');
  expect(html).toContain('id="continuity-digest-toggle"');
  expect(html).toMatch(
    /id="continuity-download-all"[\s\S]*?class="i-download"/,
  );
  expect(html).toContain('id="continuity-mark-seen"');
  expect(html).toMatch(
    /id="continuity-mark-seen"[\s\S]*?class="hidden i-clear"[\s\S]*?title="Mark seen"/,
  );
  // Request board entry
  expect(html).toContain('id="requestboard"');
  // Multi-room ACL and guest-invite operations controls
  expect(html).toContain('name="linkvisibility"');
  expect(html).toContain('name="linkprivate"');
  expect(html).toContain('name="allowprivatecrosslinking"');
  expect(html).toContain('name="invitecap"');
  expect(html).toContain('name="inviteaudittbody"');
  expect(html).toContain('class="roomopts-invite-field"');
  expect(html).toMatch(
    /name="invitecopy"[\s\S]*?hidden[\s\S]*?disabled[\s\S]*?<\/button>/,
  );
  // Password access uses aligned compact settings and a period table.
  expect(html).toContain('class="roomopts-access-grid"');
  expect(html).toContain("Period (days)");
  expect(html).toContain("Prepare (days)");
  expect(html).toContain('class="roomopts-password-entry"');
  expect(html).toContain('class="roomopts-password-table"');
  expect(html).toMatch(
    /name="passwordemptyrow"[\s\S]*?No passwords generated yet\./,
  );
  expect(html).toMatch(/name="passwordcurrentrow" class="hidden"/);
  expect(html).toMatch(/name="passwordnextrow" class="hidden"/);
  expect(html).toMatch(
    /<code[\s\S]*?name="passwordcurrent"[\s\S]*?<\/code>/,
  );
  expect(html).toMatch(
    /<code[\s\S]*?name="passwordnext"[\s\S]*?<\/code>/,
  );
  expect(html).not.toMatch(/<input[^>]+name="passwordcurrent"/);
  expect(html).not.toMatch(/<input[^>]+name="passwordnext"/);
  // Report dialog fields are explicitly labelled and validation-ready.
  expect(html).toContain('for="report-room"');
  expect(html).toMatch(/id="report-room"[\s\S]*?readonly/);
  expect(html).toContain('for="report-message"');
  expect(html).toMatch(
    /id="report-message"[\s\S]*?maxlength="2000"[\s\S]*?required/,
  );
  expect(html).toMatch(
    /id="report-error"[\s\S]*?role="alert"[\s\S]*?hidden/,
  );
  expect(html).not.toContain("jurisdication");
  expect(html).not.toContain("but dn");
});

test("room-access.ejs renders the protected-room gate", async () => {
  const html = await render("room-access.ejs", {
    pagename: "Protected room",
    roomid: "Room123",
    error: "",
    STATUS_HREF: "/status",
  });
  expect(html).toContain("This room is password protected");
  expect(html).toContain('action="/r/Room123/access"');
  expect(html).not.toContain("room name");
});

test("register.ejs renders without error", async () => {
  const html = await render("register.ejs", { pagename: "Register" });
  expect(html).toContain("<body");
  expect(html).toContain("Register");
});

test("terms.ejs renders without error", async () => {
  const html = await render("terms.ejs", {
    pagename: "Terms of Service and Privacy Policy",
  });
  expect(html).toContain("<body");
  expect(html).toContain("TestSite");
});

test("rules.ejs renders without error", async () => {
  const html = await render("rules.ejs", { pagename: "The Rules" });
  expect(html).toContain("<body");
  expect(html).toContain("TestSite");
});

test("error.ejs renders without error and shows the error message", async () => {
  const html = await render("error.ejs", {
    pagename: "Error",
    error: "Something went wrong with the test",
  });
  expect(html).toContain("Something went wrong with the test");
  expect(html).toContain("<body");
});

test("notfound.ejs renders without error", async () => {
  const html = await render("notfound.ejs", { pagename: "404" });
  expect(html).toContain("<body");
  expect(html).toContain("TestSite");
});

// ─────────────────────────────────────────────────────────────────────────────
// User profile
// ─────────────────────────────────────────────────────────────────────────────

test("user.ejs renders without error for a basic user", async () => {
  const user = makeUser();
  const info = makeInfo();
  const html = await render("user.ejs", {
    pagename: "User TestUser",
    user,
    info,
  });
  expect(html).toContain("TestUser");
  expect(html).toContain("<body");
});

test("user.ejs renders with gravatar when photo is set", async () => {
  const user = makeUser({
    gravatar: "https://gravatar.com/avatar/abc?size=200",
  });
  const info = makeInfo({ gravatar: user.gravatar });
  const html = await render("user.ejs", {
    pagename: "User TestUser",
    user,
    info,
  });
  expect(html).toContain("gravatar.com");
  expect(html).toContain("TestUser");
});

test("user.ejs renders for moderator role", async () => {
  const user = makeUser({ role: "mod" });
  const info = makeInfo({ role: "mod" });
  const html = await render("user.ejs", {
    pagename: "User TestUser",
    user,
    info,
  });
  expect(html).toContain("Moderator");
});

// ─────────────────────────────────────────────────────────────────────────────
// Account page
// ─────────────────────────────────────────────────────────────────────────────

test("account.ejs renders without error", async () => {
  const user = makeUser();
  const html = await render("account.ejs", {
    pagename: "Your Account",
    user,
    achievements: makeAchievements(),
  });
  expect(html).toContain("TestUser");
  expect(html).toContain('<form id="account"');
  expect(html).toContain('class="account-page-legacy"');
  expect(html).toContain("Edit your account settings");
  expect(html).toContain('id="account-tab-settings"');
  expect(html).toContain('id="account-tab-achievements"');
  expect(html).toContain('id="account-panel-achievements"');
  expect(html).not.toContain("TestSite PRO");
  expect(html).not.toContain("Of course!");
  expect(html).toMatch(
    /class="account-tfa-header"[\s\S]*?<h3>Two factor authentication<\/h3>[\s\S]*?<button id="tfa"/,
  );
  expect(html).not.toContain("account-hero");
  expect(html).not.toContain("settings-panel");
});

test("account.ejs reflects user email when set", async () => {
  const user = makeUser({ email: "user@example.com" });
  const html = await render("account.ejs", {
    pagename: "Your Account",
    user,
    achievements: makeAchievements(),
  });
  expect(html).toContain("user@example.com");
});

test("account.ejs shows 2FA enable button when twofactor is falsy", async () => {
  const user = makeUser({ twofactor: false });
  const html = await render("account.ejs", {
    pagename: "Your Account",
    user,
    achievements: makeAchievements(),
  });
  expect(html).toContain("Enable");
});

test("account.ejs shows 2FA disable button when twofactor is set", async () => {
  const user = makeUser({ twofactor: "JBSWY3DPEHPK3PXP" });
  const html = await render("account.ejs", {
    pagename: "Your Account",
    user,
    achievements: makeAchievements(),
  });
  expect(html).toContain("Disable");
});

test("account.ejs renders the same achievement cards as the public profile", async () => {
  const user = makeUser();
  const achievements = makeAchievements({
    unlocked: 1,
    total: 80,
    all: [
      {
        title: "First Stack",
        description: "Upload 10 files",
        current: 10,
        required: 10,
        unlocked: true,
        rarity: "common",
        icon: "fa-solid fa-file",
      },
    ],
  });
  const html = await render("account.ejs", {
    pagename: "Your Account",
    user,
    achievements,
  });
  expect(html).toContain("1 / 80");
  expect(html).toContain("First Stack");
  expect(html).toContain("Upload 10 files");
  expect(html).toContain(`href="/u/${user.account}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Moderation log
// ─────────────────────────────────────────────────────────────────────────────

test("modlog.ejs renders with empty records list", async () => {
  const html = await render("modlog.ejs", {
    pagename: "Moderation Log",
    records: [],
  });
  expect(html).toContain("<body");
  expect(html).toContain("TestSite");
});

test("modlog.ejs renders with a record entry", async () => {
  const records = [makeRecord()];
  const html = await render("modlog.ejs", {
    pagename: "Moderation Log",
    records,
  });
  expect(html).toContain("rec001");
});

test("modlogdetail.ejs renders a full record", async () => {
  const record = makeRecord({
    text: "Banned for spamming",
    ips: ["127.0.0.1"],
    accounts: ["spammer"],
  });
  const html = await render("modlogdetail.ejs", {
    pagename: "Moderation Log",
    record,
  });
  expect(html).toContain("Banned for spamming");
  expect(html).toContain("testroom");
  expect(html).toContain("ModUser");
});

test("modlogdetail.ejs renders without IPs (ban by account only)", async () => {
  const record = makeRecord({ ips: null });
  const html = await render("modlogdetail.ejs", {
    pagename: "Moderation Log",
    record,
  });
  expect(html).toContain("Test ban reason");
});

// ─────────────────────────────────────────────────────────────────────────────
// Toplists
// ─────────────────────────────────────────────────────────────────────────────

function makeToplistStats(overrides = {}) {
  return Object.assign(
    {
      list: "uploaded",
      page: 0,
      next: false,
      results: [],
    },
    overrides,
  );
}

test("toplist.ejs (uploaded) renders with empty results", async () => {
  const html = await render("toplist.ejs", {
    pagename: "Top Users",
    list: "uploaded",
    stats: makeToplistStats({ list: "uploaded" }),
  });
  expect(html).toContain("TestSite");
  expect(html).toContain('<table id="toplist"');
});

test("toplist.ejs (files) renders with empty results", async () => {
  const html = await render("toplist.ejs", {
    pagename: "Top Users",
    list: "files",
    stats: makeToplistStats({ list: "files" }),
  });
  expect(html).toContain('<table id="toplist"');
});

test("toplist.ejs renders user rows when results are present", async () => {
  const fakeUser = { name: "UploadKing", account: "uploadking", role: "user" };
  const stats = makeToplistStats({
    results: [{ rank: 1, user: fakeUser, num: "10 GiB" }],
    next: true,
  });
  const html = await render("toplist.ejs", {
    pagename: "Top Users",
    list: "uploaded",
    stats,
  });
  expect(html).toContain("UploadKing");
  expect(html).toContain("10 GiB");
  expect(html).toContain("Next page");
});

// ─────────────────────────────────────────────────────────────────────────────
// Discover (mod-only admin page)
// ─────────────────────────────────────────────────────────────────────────────

test("discover.ejs renders with zero active rooms", async () => {
  const html = await render("discover.ejs", {
    pagename: "Discover",
    rooms: [],
    users: 0,
    files: 0,
  });
  expect(html).toContain("Discover rooms");
  expect(html).toContain("0 users");
});

test("status.ejs renders the public infographic and privacy contract", async () => {
  const status = makeStatus();
  const html = await render("status.ejs", {
    pagename: "Service status",
    statusPage: true,
    statusApiHref: "/api/public/status/test-status-token",
    statusRefreshSec: 5 * 60,
    status,
    statusJSON: JSON.stringify(status),
  });
  expect(html).toContain("Drive storage");
  expect(html).toContain("refreshes every 5 minutes");
  expect(html).not.toContain("Drive horizon");
  expect(html).toContain('class="service-availability"');
  expect(html).toContain("Service history");
  expect(html).toContain("24 hours ago");
  expect((html.match(/data-status="unknown"/g) || []).length).toBe(48);
  expect(html).toContain("Transfer history");
  expect(html).toContain("Uploaded");
  expect(html).toContain("Downloaded");
  expect(html).toContain("two-hour period");
  expect(html).toContain("Unfulfilled");
  expect(html).toContain("Overall completion");
  expect(html).toContain("Useful averages");
  expect(html).toContain("Uploads and downloads");
  expect(html).toContain("System checks");
  expect(html).toContain("private details removed");
  expect(html).toContain("/api/public/status");
  expect(html).toContain("/status.css");
});

test("discover.ejs renders a room row", async () => {
  const rooms = [
    {
      roomid: "abc123",
      name: "My Room",
      users: 3,
      files: 7,
      owners: ["owner1"],
      id: "abc123",
    },
  ];
  const html = await render("discover.ejs", {
    pagename: "Discover",
    rooms,
    users: 3,
    files: 7,
  });
  expect(html).toContain("My Room");
  expect(html).toContain("owner1");
  expect(html).toContain("abc123");
});

// ─────────────────────────────────────────────────────────────────────────────
// head.ejs and footer.ejs — included by every view; verify them standalone too
// ─────────────────────────────────────────────────────────────────────────────

test("head.ejs includes the CSS link", async () => {
  const html = await render("head.ejs", { pagename: "Test Page" });
  expect(html).toContain('rel="stylesheet"');
  expect(html).toContain("/style.css");
  expect(html).toContain(`v=${V}`);
});

test("footer.ejs renders navigation links", async () => {
  const html = await render("footer.ejs", { STATUS_HREF: "/status" });
  expect(html).toContain("<footer");
  expect(html).toContain("/terms");
  expect(html).toContain("/rules");
  expect(html).toContain("Home");
  expect(html).toContain('href="/status"');
});

test("footer.ejs hides the status link when the dashboard is protected", async () => {
  const html = await render("footer.ejs", { STATUS_HREF: "" });
  expect(html).not.toContain('href="/status"');
});
