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
      achievements: {
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
      },
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
  });
  expect(html).toContain("TestUser");
  expect(html).toContain('<form id="account"');
});

test("account.ejs reflects user email when set", async () => {
  const user = makeUser({ email: "user@example.com" });
  const html = await render("account.ejs", { pagename: "Your Account", user });
  expect(html).toContain("user@example.com");
});

test("account.ejs shows 2FA enable button when twofactor is falsy", async () => {
  const user = makeUser({ twofactor: false });
  const html = await render("account.ejs", { pagename: "Your Account", user });
  expect(html).toContain("Enable");
});

test("account.ejs shows 2FA disable button when twofactor is set", async () => {
  const user = makeUser({ twofactor: "JBSWY3DPEHPK3PXP" });
  const html = await render("account.ejs", { pagename: "Your Account", user });
  expect(html).toContain("Disable");
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
  const html = await render("footer.ejs");
  expect(html).toContain("<footer");
  expect(html).toContain("/terms");
  expect(html).toContain("/rules");
  expect(html).toContain("Home");
});
