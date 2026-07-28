"use strict";

const {
  isValidRoomId,
  isCrossLinkingAllowed,
  normalizeLinkedRooms,
  normalizeLinkedRoomEntries,
  normalizeLinkRules,
  validateLinkRuleExpression,
  validateLinkRules,
  splitLinkedRoomInput,
  resolveLinkedRoomTokens,
  resolveLinkedRoomEntries,
  addLinkedRoom,
  removeLinkedRoom,
  removeLinkedRoomEntry,
  upsertLinkedRoomEntry,
  markLinkedClientFile,
  linkedContentExclusionReason,
  isLinkableSourceFile,
  includeLinkedForRole,
  LINK_VISIBILITIES,
  normalizeLinkVisibility,
  linkVisibilityAllows,
  sourceAllowsCrossLink,
  sourceAllowsPrivateCrossLink,
  linkSourceStatus,
  fileMatchesLinkRules,
  filterLinkedSourceFiles,
  serializeLinkedRoomEntries,
  summarizeLinkRules,
  summarizeLinkAccess,
  isEmptyLinkRules,
  MS_PER_HOUR,
} = require("../../lib/room/room-links");

describe("room-links (shipped)", () => {
  test("isValidRoomId", () => {
    expect(isValidRoomId("QV39BPLjcz")).toBe(true);
    expect(isValidRoomId("ab")).toBe(false);
    expect(isValidRoomId("../x")).toBe(false);
  });

  test("isCrossLinkingAllowed default denied", () => {
    expect(isCrossLinkingAllowed(undefined)).toBe(false);
    expect(isCrossLinkingAllowed(true)).toBe(true);
  });

  test("source permissions and link status default to denied", () => {
    expect(sourceAllowsCrossLink({ allowCrossLinking: true })).toBe(true);
    expect(sourceAllowsCrossLink({ get: () => false })).toBe(false);
    expect(
      sourceAllowsPrivateCrossLink({ allowPrivateCrossLinking: true }),
    ).toBe(true);
    expect(sourceAllowsPrivateCrossLink({ get: () => undefined })).toBe(false);
    expect(linkSourceStatus({ exists: false })).toBe("missing");
    expect(linkSourceStatus({ exists: true, allowCrossLinking: false })).toBe(
      "denied",
    );
    expect(linkSourceStatus({ exists: true, allowCrossLinking: true })).toBe(
      "ok",
    );
  });

  test("normalizeLinkedRooms legacy ids", () => {
    expect(normalizeLinkedRooms(null)).toEqual([]);
    expect(normalizeLinkedRooms("a1b2c3d4e5, a1b2c3d4e5, bad")).toEqual([
      "a1b2c3d4e5",
    ]);
  });

  test("normalizeLinkedRoomEntries preserves rules (backward compatible)", () => {
    const legacy = normalizeLinkedRoomEntries(["sourceRoomA1", "sourceRoomB2"]);
    expect(legacy).toEqual([
      { roomId: "sourceRoomA1" },
      { roomId: "sourceRoomB2" },
    ]);

    const rich = normalizeLinkedRoomEntries([
      {
        roomId: "sourceRoomA1",
        name: "Dump",
        rules: {
          nameContains: " map ",
          types: ["document", "bogus", "document"],
          maxAgeHours: 48,
          minAgeHours: 0,
        },
      },
      "sourceRoomA1",
    ]);
    expect(rich).toHaveLength(1);
    expect(rich[0].roomId).toBe("sourceRoomA1");
    expect(rich[0].name).toBe("Dump");
    expect(rich[0].rules.nameContains).toBe("map");
    expect(rich[0].rules.types).toEqual(["document"]);
    expect(rich[0].rules.maxAgeHours).toBe(48);
    expect(rich[0].rules.minAgeHours).toBeUndefined();
  });

  test("normalizes visibility and private-source opt-in", () => {
    expect(LINK_VISIBILITIES).toContain("members");
    expect(normalizeLinkVisibility("OWNERS")).toBe("owners");
    expect(normalizeLinkVisibility("invalid")).toBe("all");
    expect(
      normalizeLinkedRoomEntries([
        {
          roomId: "sourceRoomA1",
          visibility: "members",
          allowPrivateSource: true,
        },
      ]),
    ).toEqual([
      {
        roomId: "sourceRoomA1",
        visibility: "members",
        allowPrivateSource: true,
      },
    ]);
  });

  test("destination link ACL supports signed-in, member, owner, and mod tiers", () => {
    expect(linkVisibilityAllows("all", {})).toBe(true);
    expect(linkVisibilityAllows("authenticated", { authenticated: true })).toBe(
      true,
    );
    expect(linkVisibilityAllows("members", { authenticated: true })).toBe(
      false,
    );
    expect(linkVisibilityAllows("members", { member: true })).toBe(true);
    expect(linkVisibilityAllows("owners", { owner: true })).toBe(true);
    expect(linkVisibilityAllows("mods", { owner: true })).toBe(false);
    expect(linkVisibilityAllows("mods", { role: "mod" })).toBe(true);
  });

  test("normalizeLinkRules empty → null", () => {
    expect(normalizeLinkRules({})).toBeNull();
    expect(normalizeLinkRules({ nameContains: "  " })).toBeNull();
    expect(isEmptyLinkRules(null)).toBe(true);
  });

  test("validates linked-file expression syntax and unsafe regex", () => {
    expect(validateLinkRuleExpression("map OR dungeon").valid).toBe(true);
    expect(validateLinkRuleExpression("/^pf2.*\\.pdf$/i").valid).toBe(true);
    expect(validateLinkRuleExpression("/unterminated").valid).toBe(false);
    expect(validateLinkRuleExpression("/(a+)+$/").valid).toBe(false);
    expect(
      validateLinkRules({ userContains: "/^(alice|bob)$/i" }),
    ).toMatchObject({ valid: true });
    expect(validateLinkRules({ tagContains: "/[/i" }).errors).toHaveProperty(
      "tagContains",
    );
  });

  test("serializeLinkedRoomEntries stable re-normalize", () => {
    const raw = [
      { roomId: "roomAlpha01", rules: { tagContains: "rpg" } },
      "roomBeta0022",
    ];
    const a = serializeLinkedRoomEntries(raw);
    const b = serializeLinkedRoomEntries(JSON.parse(a));
    expect(a).toBe(b);
    expect(normalizeLinkedRoomEntries(JSON.parse(a))).toEqual(
      normalizeLinkedRoomEntries(raw),
    );
  });

  test("splitLinkedRoomInput multi-word names", () => {
    expect(splitLinkedRoomInput("Campaign Maps, abCdEf12Gh")).toEqual([
      "Campaign Maps",
      "abCdEf12Gh",
    ]);
  });

  test("resolveLinkedRoomTokens by id and name", () => {
    const catalog = [
      { roomid: "sourceRoomA1", name: "Dump Room" },
      { roomid: "sourceRoomB2", name: "Campaign Maps" },
    ];
    const byName = resolveLinkedRoomTokens("Campaign Maps", catalog);
    expect(byName.ids).toEqual(["sourceRoomB2"]);
  });

  test("resolveLinkedRoomEntries merges rules + names from catalog", () => {
    const catalog = [
      { roomid: "sourceRoomA1", name: "Dump Room" },
      { roomid: "sourceRoomB2", name: "Campaign Maps" },
    ];
    const { entries, unresolved } = resolveLinkedRoomEntries(
      [
        {
          roomId: "sourceRoomA1",
          rules: { nameContains: "pdf", types: ["document"] },
        },
        "Campaign Maps",
        "No Such Room",
      ],
      catalog,
      "hubRoom9999",
    );
    expect(unresolved).toEqual(["No Such Room"]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      roomId: "sourceRoomA1",
      name: "Dump Room",
      rules: { nameContains: "pdf", types: ["document"] },
    });
    expect(entries[1]).toMatchObject({
      roomId: "sourceRoomB2",
      name: "Campaign Maps",
    });
    expect(entries[1].rules).toBeUndefined();
  });

  test("resolveLinkedRoomEntries rejects invalid expressions before storage", () => {
    expect(() =>
      resolveLinkedRoomEntries(
        [
          {
            roomId: "sourceRoomA1",
            rules: { nameContains: "/unterminated" },
          },
        ],
        [{ roomid: "sourceRoomA1", name: "Dump Room" }],
      ),
    ).toThrow(/Filename rule/);
  });

  test("add / remove / upsert entries", () => {
    expect(addLinkedRoom([], "sourceRoom1")).toEqual(["sourceRoom1"]);
    expect(
      removeLinkedRoom(["roomAlpha1", "roomBeta22"], "roomAlpha1"),
    ).toEqual(["roomBeta22"]);
    let list = upsertLinkedRoomEntry([], {
      roomId: "sourceRoomA1",
      rules: { nameContains: "a" },
    });
    list = upsertLinkedRoomEntry(list, {
      roomId: "sourceRoomA1",
      rules: { tagContains: "b" },
    });
    expect(list).toHaveLength(1);
    expect(list[0].rules.tagContains).toBe("b");
    expect(list[0].rules.nameContains).toBeUndefined();
    list = removeLinkedRoomEntry(list, "sourceRoomA1");
    expect(list).toEqual([]);
  });

  test("markLinkedClientFile / includeLinkedForRole", () => {
    const f = markLinkedClientFile(
      { key: "k1", name: "x.pdf", meta: { type: "PDF" }, tags: { user: "a" } },
      "srcRoom99",
      "Dump Room",
    );
    expect(f.linked).toBe(true);
    expect(f.linkedFrom).toBe("srcRoom99");
    expect(
      includeLinkedForRole({ key: "1", meta: {}, hidden: true }, "white"),
    ).toBe(false);
    expect(
      includeLinkedForRole({ key: "1", meta: {}, hidden: true }, "mod"),
    ).toBe(false);
  });

  test("isLinkableSourceFile excludes requests", () => {
    expect(isLinkableSourceFile({ key: "1", meta: {} })).toBe(true);
    expect(isLinkableSourceFile({ key: "1", meta: { request: true } })).toBe(
      false,
    );
    expect(
      linkedContentExclusionReason({
        key: "rq1",
        meta: { request: true },
        status: "fulfilled",
      }),
    ).toBe("request");
    expect(
      linkedContentExclusionReason({
        key: "upload1",
        meta: { requesterNick: "alice" },
      }),
    ).toBeNull();
  });

  describe("fileMatchesLinkRules (shipped path)", () => {
    const now = 1_700_000_000_000;
    const base = {
      key: "f1",
      name: "Session3-map-final.pdf",
      type: "document",
      tags: { user: "alice", system: "dnd5e" },
      uploaded: now - 10 * MS_PER_HOUR,
    };

    test("empty rules pass all", () => {
      expect(fileMatchesLinkRules(base, null, now)).toBe(true);
      expect(fileMatchesLinkRules(base, {}, now)).toBe(true);
    });

    test("nameContains match / non-match", () => {
      expect(fileMatchesLinkRules(base, { nameContains: "MAP" }, now)).toBe(
        true,
      );
      expect(fileMatchesLinkRules(base, { nameContains: "video" }, now)).toBe(
        false,
      );
    });

    test("nameContains comma-delimited OR terms", () => {
      // base name: Session3-map-final.pdf
      expect(
        fileMatchesLinkRules(base, { nameContains: "video, MAP, city" }, now),
      ).toBe(true);
      expect(
        fileMatchesLinkRules(base, { nameContains: "video, city" }, now),
      ).toBe(false);
      // array form also works via normalize
      const rules = normalizeLinkRules({
        nameContains: " dungeon , map , dungeon ",
      });
      expect(rules.nameContains).toBe("dungeon, map");
      expect(fileMatchesLinkRules(base, rules, now)).toBe(true);
    });

    test("supports explicit AND/OR with AND precedence", () => {
      expect(
        fileMatchesLinkRules(
          base,
          { nameContains: "video OR session3 AND map" },
          now,
        ),
      ).toBe(true);
      expect(
        fileMatchesLinkRules(
          base,
          { nameContains: "session3 AND city OR video" },
          now,
        ),
      ).toBe(false);
    });

    test("supports regular expressions for filename", () => {
      expect(
        fileMatchesLinkRules(
          base,
          { nameContains: "/^session3.*\\.pdf$/i" },
          now,
        ),
      ).toBe(true);
      expect(
        fileMatchesLinkRules(base, { nameContains: "/\\.epub$/i" }, now),
      ).toBe(false);
    });

    test("tagContains match key or value", () => {
      expect(fileMatchesLinkRules(base, { tagContains: "dnd" }, now)).toBe(
        true,
      );
      expect(fileMatchesLinkRules(base, { tagContains: "USER" }, now)).toBe(
        true,
      );
      expect(fileMatchesLinkRules(base, { tagContains: "zzz" }, now)).toBe(
        false,
      );
    });

    test("tag AND terms may match different tag keys or values", () => {
      expect(
        fileMatchesLinkRules(
          base,
          { tagContains: "user AND dnd5e" },
          now,
        ),
      ).toBe(true);
      expect(
        fileMatchesLinkRules(
          base,
          { tagContains: "/^alice$/i AND /^system$/" },
          now,
        ),
      ).toBe(true);
    });

    test("matches uploader usernames and bot display names", () => {
      expect(
        fileMatchesLinkRules(base, { userContains: "alice" }, now),
      ).toBe(true);
      expect(
        fileMatchesLinkRules(base, { userContains: "bob" }, now),
      ).toBe(false);
      expect(
        fileMatchesLinkRules(
          {
            ...base,
            tags: {},
            meta: { botName: "Telegram Releases" },
          },
          { userContains: "/telegram/i" },
          now,
        ),
      ).toBe(true);
    });

    test("invalid expressions fail closed", () => {
      expect(
        fileMatchesLinkRules(base, { nameContains: "/unterminated" }, now),
      ).toBe(false);
    });

    test("types filter", () => {
      expect(
        fileMatchesLinkRules(base, { types: ["document", "image"] }, now),
      ).toBe(true);
      expect(fileMatchesLinkRules(base, { types: ["video"] }, now)).toBe(false);
    });

    test("maxAgeHours — no older than X", () => {
      // file is 10h old; max 24h → pass
      expect(fileMatchesLinkRules(base, { maxAgeHours: 24 }, now)).toBe(true);
      // max 5h → fail (too old)
      expect(fileMatchesLinkRules(base, { maxAgeHours: 5 }, now)).toBe(false);
    });

    test("minAgeHours — older than X", () => {
      // at least 5h old → pass
      expect(fileMatchesLinkRules(base, { minAgeHours: 5 }, now)).toBe(true);
      // at least 20h old → fail (too new)
      expect(fileMatchesLinkRules(base, { minAgeHours: 20 }, now)).toBe(false);
    });

    test("combined rules AND logic", () => {
      expect(
        fileMatchesLinkRules(
          base,
          {
            nameContains: "map",
            userContains: "alice",
            types: ["document"],
            maxAgeHours: 48,
            minAgeHours: 1,
          },
          now,
        ),
      ).toBe(true);
      expect(
        fileMatchesLinkRules(
          base,
          {
            nameContains: "map",
            types: ["image"],
          },
          now,
        ),
      ).toBe(false);
    });
  });

  test("filterLinkedSourceFiles applies role + rules", () => {
    const now = Date.now();
    const files = [
      {
        key: "a",
        name: "keep-me.pdf",
        type: "document",
        tags: {},
        uploaded: now - 1000,
        meta: {},
      },
      {
        key: "b",
        name: "drop-video.mp4",
        type: "video",
        tags: {},
        uploaded: now - 1000,
        meta: {},
      },
      {
        key: "c",
        name: "hidden.pdf",
        type: "document",
        tags: {},
        uploaded: now - 1000,
        meta: {},
        hidden: true,
      },
      {
        key: "d",
        name: "req",
        type: "file",
        tags: {},
        uploaded: now,
        meta: { request: true },
      },
    ];
    const out = filterLinkedSourceFiles(
      files,
      { nameContains: "keep", types: ["document"] },
      "white",
      now,
    );
    expect(out.map((f) => f.key)).toEqual(["a"]);
  });

  test("denied cross-link yields no files in filter pipeline composition", () => {
    // Pure contract used by collectLinkedClientFiles
    const allowed = sourceAllowsCrossLink({ allowCrossLinking: true });
    const denied = sourceAllowsCrossLink({ allowCrossLinking: false });
    const files = [
      {
        key: "x",
        name: "a.pdf",
        type: "document",
        tags: {},
        uploaded: Date.now(),
        meta: {},
      },
    ];
    expect(allowed).toBe(true);
    expect(denied).toBe(false);
    // When denied, server skips source entirely — no filter results.
    const fromDenied = denied
      ? filterLinkedSourceFiles(files, null, "white")
      : [];
    expect(fromDenied).toEqual([]);
  });

  test("summarizeLinkRules", () => {
    expect(summarizeLinkRules(null)).toMatch(/All finished/i);
    expect(
      summarizeLinkRules({
        nameContains: "map",
        userContains: "alice",
        types: ["document"],
      }),
    ).toMatch(/uploader~"alice"/);
  });

  test("private sources report explicit status and access summaries", () => {
    expect(
      linkSourceStatus({
        exists: true,
        allowCrossLinking: true,
        privateSource: true,
        allowPrivateSource: false,
      }),
    ).toBe("private");
    expect(
      linkSourceStatus({
        exists: true,
        allowCrossLinking: true,
        privateSource: true,
        allowPrivateSource: true,
      }),
    ).toBe("private");
    expect(
      linkSourceStatus({
        exists: true,
        allowCrossLinking: true,
        privateSource: true,
        allowPrivateSource: true,
        allowPrivateCrossLinking: true,
      }),
    ).toBe("ok");
    expect(
      summarizeLinkAccess({
        visibility: "members",
        allowPrivateSource: true,
      }),
    ).toMatch(/Room members.*invite-only source allowed/i);
  });
});
