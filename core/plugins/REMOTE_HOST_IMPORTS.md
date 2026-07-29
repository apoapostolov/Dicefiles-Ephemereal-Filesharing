# Remote host imports (design sketch)

How Dicefiles should grow beyond **Mega.nz** toward the hosts hobby communities actually use: MediaFire, 4shared, Pixeldrain, Gofile, Catbox, Workupload, Dropbox public links, etc.

The first implementation slice is now shipped: a shared downloader registry,
the existing Mega.nz adapter, the `remote-import` bot, and an official-API
Pixeldrain provider. Gofile, MediaFire, 4shared, and the shell bridge remain
planned.

The implementation-ready 1.4.6 scope, provider contract, Gofile design,
Plowshare security boundary, migration rules, and acceptance tests are defined
in [the multi-host remote imports proposal](../../docs/MULTI_HOST_REMOTE_IMPORTS.md).

This is intentionally separate from shipped
[Dicefiles trusted-host federation](../../docs/FEDERATION.md). Federation
authenticates another operator-pinned Dicefiles server and streams an approved
room without copying it. Remote host import treats a third-party file locker as
an untrusted download source and materializes its bytes into local storage.

**Library research** (GitHub/npm candidates, embed vs product boundary,
shell/debrid options):
[REMOTE_HOST_LIBRARY_RESEARCH.md](../../docs/REMOTE_HOST_LIBRARY_RESEARCH.md).

---

## 1. Goal

Operators paste a supported **folder or file URL** into the Remote Host Import
room bot. Dicefiles resolves it through an allowlisted provider and streams the
bytes through the same bounded upload path used by Mega.nz.

Constraints that match Dicefiles:

- Ephemeral rooms + TTL — bulk imports must be rate-limited and size-capped.
- Self-hosted trust model — plugins run in-process; only **opt-in** operators enable hosters.
- No marketplace of untrusted scrapers in core; prefer well-known libs / shell CLIs with clear licenses.

---

## 2. Shared contract (do not fork per host)

Every remote hoster implements the same thin interface already used by Mega.nz:

```ts
// Logical shape (JS in practice)
type RemoteEntry = {
  name: string;
  size?: number;
  isDir?: boolean;
  sourceId?: string;
  openStream?: () => Promise<NodeJS.ReadableStream>;
  download?: () => Promise<Buffer>;
};

type RemoteDownloader = {
  /** Host id: mega | mediafire | fourshared | pixeldrain | … */
  id: string;
  /** Return true if this adapter can handle the URL */
  canHandle(url: string): boolean;
  /**
   * List a folder or resolve a single-file link to one entry.
   * credentials optional (premium / account hosts).
   */
  listFolder(url: string, credentials?: object): Promise<RemoteEntry[]>;
};
```

Orchestration (shared, not per-plugin):

1. Match URL → downloader (`canHandle` / registry).
2. `listFolder` → entries (skip dirs or recurse with depth cap).
3. For each file: `openStream()` when available, with bounded buffer fallback.
4. `uploadFile({ roomId, name, body, size, meta: { plugin, sourceUrl, host } })`.
5. Emit normal `file_uploaded` webhooks; optional plugin events later.

Shipped code uses `ctx.remoteDownloaders`, a registry of provider adapters.
`ctx.megaDownloader` remains as a compatibility surface for the dedicated
Mega.nz bot.

---

## 3. Host matrix — libraries & strategies

| Host (community use) | Strategy | Mature open-source / tooling | Notes |
|----------------------|----------|------------------------------|--------|
| **Mega.nz** | Native JS SDK | **[megajs](https://www.npmjs.com/package/megajs)** ([mega.js.org](https://mega.js.org/)); CLI **[megajs-cli](https://github.com/qgustavor/megajs-cli)**; optional official **[MEGAcmd](https://github.com/meganz/MEGAcmd)** shell-out | Already optionalDep + `createMegaDownloader`. Prefer megajs in-process; MEGAcmd if operators already install it. |
| **MediaFire** | HTML/API scrape or premium API | No first-class maintained Node SDK; common pattern is **Python/Go scrapers** or shell tools that resolve the final CDN URL then HTTP GET | Fragile free-tier; captcha/wait timers. Prefer stream-after-resolve; document breakage risk. Account cookies optional. |
| **4shared** (“4storage” in some communities) | Link resolve + HTTP | Sparse Node libs; same class as MediaFire — often **plowshare**-class modules or custom resolve | Free downloads often throttled / wait. Treat as best-effort adapter. |
| **Pixeldrain** | Official HTTP API | Direct REST (`pixeldrain.com/api/...`) — thin native adapter, no heavy SDK | Good first “easy host” after Mega.nz (stable API, community-popular). |
| **Gofile.io** | Public API | Thin REST client (folder/content tokens) | Good second easy host. |
| **Catbox / Litterbox** | Direct file URL or upload API | Direct GET for public links; upload API for reverse direction | Import is usually single-file URL. |
| **Workupload** | Resolve + GET | Site-specific scrape or community scripts | Same fragility class as MediaFire. |
| **Dropbox / Google Drive** shared links | Official or well-known resolve | Dropbox shared-link → `?dl=1`; Drive is ToS-sensitive (prefer official APIs + OAuth, not scrapers) | Only enable when operator accepts ToS surface. |
| **Multi-hoster CLI umbrella** | Shell-out | **[plowshare](https://github.com/mcrapet/plowshare)** (`plowdown`) — classic multi-hoster; **rclone** for cloud remotes (not classic free hosts) | Great operator escape hatch: plugin `shell-downloader` runs `plowdown URL -o -` or temp file, then ingest. |

**Avoid as core dependencies:** random abandoned “mediafire-dl” npm packages without audit, browser automation (Playwright) for free hosts (heavy, brittle), or yt-dlp (video sites, not classic file lockers).

---

## 4. Integration shapes (pick deliberately)

### A. First-party thin adapters (recommended for Mega.nz, Pixeldrain, Gofile)

- `lib/plugins/remote-import/` or one plugin id `remote-import` with `providers/*.js`.
- Config:

```json
{
  "id": "remote-import",
  "enabled": true,
  "config": {
    "roomId": "YourRoomId12",
    "urls": ["https://mega.nz/folder/…", "https://pixeldrain.com/u/…"],
    "providers": ["mega", "pixeldrain", "gofile"],
    "maxBytesPerFile": 104857600,
    "maxFilesPerRun": 50
  }
}
```

- Optional deps only: `megajs` (already), nothing for Pixeldrain/Gofile beyond `fetch`.

### B. Shell bridge plugin (recommended for MediaFire / 4shared / long tail)

- Plugin id: `shell-import` or `plowshare-import`.
- Config: `commandTemplate`, allowlist of binaries (`plowdown`, `megadl`, `curl`), temp dir, timeout.
- Operator installs plowshare/modules on the host OS; Dicefiles never ships hoster scrapers in-repo.
- Pros: huge host coverage without Node bitrot. Cons: ops complexity, security (command injection — template must be locked).

### C. External bot (webhook-only)

- Discord/n8n bot downloads with whatever stack they like, POSTs to automation upload API.
- Already possible; plugins are for **in-process** operator convenience.

---

## 5. Suggested build order

1. ~~Normalize Mega.nz behind a shared registry.~~ **Shipped.**
2. ~~Pixeldrain file/list adapter using the official API.~~ **Shipped.**
3. ~~`remote-import` plugin — multi-URL list, caps, shared streamed upload.~~
   **Shipped.**
4. **Gofile** authenticated folder adapter after its beta API stabilizes.
5. **`shell-import` plugin** — plowshare/MEGAcmd allowlist for
   MediaFire/4shared/long tail.
6. MediaFire/4shared native adapters only if the shell path proves too awkward
   and a maintained library appears.

---

## 6. Safety rails (non-negotiable)

- Size / file-count caps per run; provider streams flow through a bounded
  temporary file and are hashed before upload creation.
- No automatic crawl of arbitrary user-pasted hosts without owner enable + allowlist.
- Secrets (premium cookies, Mega.nz password) only via env / server config, never room chat.
- Log source URL + host id on uploaded `meta` for audit.
- Document that free hosters break often; adapters are **best-effort**.
- Respect host ToS and copyright — product is a sync tool for operators, not a piracy appliance.

---

## 7. Relation to current code

| Piece | Today |
|-------|--------|
| Registry / lifecycle | `lib/plugins/registry.js` |
| Mega.nz plugin | `lib/plugins/mega-folder/` |
| Shared provider registry | `lib/plugins/remote-downloaders.js` |
| Remote import bot | `lib/plugins/remote-import/index.js` |
| Pixeldrain provider | `lib/plugins/remote-import/pixeldrain.js` |
| Production wiring | `lib/plugins/runtime-adapters.js` |
| Docs | `DEVELOPING_PLUGINS.md`, `MEGA_FOLDER.md` |

Next code step: add Gofile behind its authenticated beta API, then evaluate the
strictly allowlisted shell bridge separately.

---

## 8. References

Full candidate matrix and rejects:
[REMOTE_HOST_LIBRARY_RESEARCH.md](../../docs/REMOTE_HOST_LIBRARY_RESEARCH.md).

- megajs: https://www.npmjs.com/package/megajs — https://mega.js.org/
- megajs-cli: https://github.com/qgustavor/megajs-cli
- MEGAcmd: https://github.com/meganz/MEGAcmd
- plowshare (multi-hoster shell): https://github.com/mcrapet/plowshare
- Pixeldrain API docs: https://pixeldrain.com/api
