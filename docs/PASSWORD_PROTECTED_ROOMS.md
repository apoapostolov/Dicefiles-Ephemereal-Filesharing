# Password-protected rooms

**Status:** Shared rotating community passwords are implemented for v1.4.5.
Cohort and personal credentials remain an additive future phase.
**Scope:** First-class shared and personal room access credentials

## Summary

Dicefiles should let a room owner place an access gate in front of the entire
room. A visitor sees a minimal password prompt before receiving the room name,
chat, files, requests, member information, plugins, or other protected data.
After a successful entry, Dicefiles grants that browser or account access until
the end of the credential's current period. The password does not need to be
entered again during that period.

The central community use case is a **rotating shared password**:

- protection is opt-in per room;
- calendar-month rotation is the recommended default;
- Dicefiles prepares the next password before the next month so owners have
  time to distribute it to contributing community members;
- the next password becomes valid only when its period starts;
- access granted by the old period expires at the boundary;
- the owner can reveal and copy current and prepared passwords from Room
  Options;
- an emergency rotation immediately invalidates the compromised password and
  its grants.

The longer-term design also supports several independently revocable
credentials. A future room
may have one shared community password, separate passwords for contributor
groups, or one personal credential per member. Every credential has its own
label, schedule, limits, audit identity, and revocation state.

This feature is an access-control convenience for communities, not digital
rights management. A shared password can be copied, and an authorized person
can copy downloaded content. Rotation limits how long a leaked credential
remains useful; personal credentials make individual leaks easier to revoke.

## Product goals

- Gate all room content before any protected metadata reaches the browser.
- Make monthly community password rotation easy enough to use continuously.
- Keep successful users authorized only until the appropriate period ends.
- Give owners time to distribute the next credential before rotation.
- Support one shared password, several cohort passwords, and personal
  credentials without changing the core access model.
- Allow emergency rotation and individual revocation.
- Compose predictably with invite-only rooms, registered accounts, owners,
  moderators, guest invites, bots, automation, cross-linking, and federation.
- Keep raw passwords out of normal room configuration exports, logs, webhooks,
  metrics, and public APIs.
- Rate-limit verification safely across all Node workers.
- Remain usable by communities that do not require registered accounts.

## Non-goals

The first release is not:

- end-to-end encryption of chat or files;
- proof that an authorized member did not redistribute content;
- a subscription, billing, or entitlement platform;
- an email, Discord, or Telegram distribution service for new passwords;
- a replacement for named room membership or guest invite links;
- an identity provider or single sign-on system;
- a way to embed passwords in room URLs.

Dicefiles never sends a raw room password to a third-party integration by
default. Distribution remains an explicit owner action.

## Terminology

- **Access policy** — the room-level rules deciding whether a credential is
  required and which principals may bypass it.
- **Credential** — one shared, cohort, or personal password record.
- **Period** — the exact interval during which one credential version is
  current, such as August 2026 in a chosen timezone.
- **Prepared credential** — the next period's generated password, visible to
  owners but not yet valid.
- **Grant** — server-side authorization proving that a browser or account
  successfully entered an accepted credential.
- **Principal** — the account or anonymous browser token receiving a grant.
- **Rotation** — promotion of the prepared credential to current and expiry of
  the prior period's grants.
- **Emergency rotation** — an immediate credential replacement, independent of
  the normal schedule.
- **Cohort** — a community group sharing one independently revocable password.

## Recommended access model

Password protection is an additional room gate, not a new meaning for
`inviteonly`.

```text
baseAccess =
  room is not invite-only
  OR user is invited
  OR browser has a valid guest-invite pass
  OR user is an owner/moderator

passwordAccess =
  password protection is disabled
  OR principal has a valid room access grant
  OR user is an owner/moderator

mayEnter = baseAccess AND passwordAccess
```

This rule is conservative and easy to explain:

- a public room with password protection needs only the password;
- an invite-only protected room requires both invitation and password;
- owners and moderators cannot lock themselves out;
- an ordinary guest invite does not silently bypass a separately enabled
  password gate.

A later version may offer `invite OR password` as an explicit alternative, but
the first release should avoid ambiguous combinations.

## Credential modes

All modes use the same credential and grant model.

### Shared community password

One password is distributed to the entire community. Monthly rotation limits
the lifetime of a widely shared value. This is the default experience.

Recommended generated form:

```text
ember-lantern-orbit-copper-harbor
```

Use a cryptographically random word list or an unambiguous encoded string with
at least 80 bits of entropy. The generator must not assemble passwords from
room names, dates, usernames, or predictable counters.

### Cohort passwords

Several active credentials represent groups such as:

- Supporting members
- Event organizers
- Rules contributors
- August convention guests

Revoking one cohort does not disrupt other contributors. Audit and access
counts identify the credential label, not individual visitors.

### Personal credentials

An owner creates one credential per intended member. The record can optionally:

- bind to the first registered account that redeems it;
- limit the number of browser activations;
- allow account-wide grants across that member's devices;
- expire on a fixed date;
- rotate on its own schedule;
- be revoked without rotating the whole community.

Personal credentials provide revocation and leak attribution, but should not
pretend to prove who actually used a shared browser or account.

### Manual password

An owner supplies a custom value and decides when to rotate it. Dicefiles
should assess weak values and warn, but owners may need compatibility with an
existing community process. Instance operators may enforce a minimum strength.

Custom values are processed through the same slow password verifier and are
never stored in exported room configuration.

### Generated non-rotating password

Dicefiles generates a strong value that remains active until an owner rotates
or disables it. This is useful for small private rooms but should be presented
after monthly rotation in the interface.

## Rotation schedules

Supported schedule types:

| Type | Example | Period boundary |
| --- | --- | --- |
| `calendar-month` | Monthly community membership | First day of each month |
| `calendar-week` | Weekly play group | Selected weekday and local time |
| `fixed-days` | Every 30 days from enablement | Anchored elapsed interval |
| `fixed-expiry` | Convention access until a date | Configured instant |
| `manual` | Owner-managed | Only explicit rotation |

Each rotating credential stores:

```json
{
  "type": "calendar-month",
  "interval": 1,
  "timezone": "Europe/Kyiv",
  "boundaryLocalTime": "00:00",
  "prepareDaysBefore": 7,
  "graceHours": 0
}
```

Use IANA timezone identifiers. Store and compare actual boundaries as UTC
instants, but calculate them from the configured community timezone.

For calendar-month mode, the normal boundary is the first of the month.
Supporting arbitrary days such as the 31st adds edge cases with little community
value and should be deferred. Fixed-day schedules cover non-calendar billing or
event cycles.

### Preparation window

A monthly password generated only at midnight on the first gives the owner no
time to distribute it. Dicefiles should therefore:

1. generate the next period's secret seven days before the boundary by default;
2. show **Next password ready** to room owners;
3. let an owner reveal and copy it;
4. keep it invalid until the exact next boundary;
5. alert owners if the next password has not been viewed as rotation approaches.

Preparing a password does not create user grants and does not reveal it through
webhooks.

### Activation

At the boundary:

1. atomically promote the prepared version to current;
2. mark the previous version expired;
3. invalidate grants tied to the previous period;
4. prepare another future version when its preparation window arrives;
5. record a privacy-safe rotation audit event.

Rotation should run proactively from a Redis-coordinated scheduler, but access
checks must calculate the expected period independently. If all workers were
offline at midnight, the old credential must still be refused after the
boundary. On startup, the scheduler catches up directly to the current period
instead of generating every missed intermediate password.

### Optional overlap

An owner may configure a short grace period, with a prominent warning that it
weakens the clean monthly boundary.

During grace:

- the previous password may be accepted;
- a grant created from it expires at the grace deadline, not at the end of the
  new period;
- an existing previous-period grant does not automatically extend;
- the current password grants access through the current period.

Default grace is zero. A practical maximum is 72 hours.

### Emergency rotation

**Rotate now**:

- creates and activates a new credential version immediately;
- increments the credential version;
- invalidates every grant from older versions;
- cancels any previously prepared next value and prepares a replacement;
- records the actor, time, credential id, and reason, but not the password;
- disconnects currently unauthorized room clients with an `access_required`
  event.

Owners may choose **Rotate after this period** for an orderly planned change,
but compromise response should be immediate.

## Authorization grants

Do not treat a long-lived browser cookie containing the password as proof.
Store short opaque identifiers in the browser and authoritative grant state in
Redis.

A grant includes:

```json
{
  "roomId": "opaque-room-id",
  "principalHash": "server-derived-value",
  "credentialId": "community",
  "credentialVersion": 12,
  "periodId": "2026-08@Europe/Kyiv",
  "grantedAt": 1785542400000,
  "expiresAt": 1788220800000,
  "scope": "browser"
}
```

The grant is valid only when:

- the room policy remains enabled;
- the credential is active;
- the credential version is still accepted;
- the grant period is the current accepted period;
- `now < expiresAt`;
- personal binding and activation limits still pass;
- no room-wide authorization epoch has been incremented.

### Grant scope

Offer two scopes:

- **This browser** — default for anonymous and signed-in visitors; uses the
  existing stable browser room token as the principal.
- **My account** — optional for signed-in users; works across their devices
  until period end.

Room owners decide whether account-wide grants are allowed. Anonymous users can
only receive browser grants. A visitor should see the scope before submitting,
not discover it afterward.

### Grant expiry

The grant expiry is the earliest of:

- the current period end;
- fixed credential expiry;
- personal membership expiry;
- configured maximum grant lifetime;
- previous-password grace deadline;
- account session expiry when account binding requires it.

Refreshing the room never extends the grant. Re-entering the current password
may recreate missing state but cannot extend beyond the same period boundary.

### Grant storage

Avoid a growing object inside the room config. Use individually expiring Redis
keys indexed by room and credential:

```text
room-access:grant:<roomId>:<principalHash>
room-access:credential-grants:<roomId>:<credentialId>
```

Redis TTL handles normal expiry. The credential index supports immediate
revocation without scanning all room users. A bounded reconciler cleans stale
index members after crashes.

Hash account ids and browser tokens with a server-secret keyed HMAC before
placing them in Redis keys or audit records.

## Secret storage

### Do not use exported room config

Dicefiles currently exports ordinary room configuration to clients.
Consequently, raw passwords, password verifiers, encrypted secrets, salts, and
recovery material must never be stored in the exported `rco:<roomId>` map.

Ordinary room config may expose only non-secret policy state after access, such
as whether protection is enabled and when the current grant expires.

### Private credential records

Store credential records in a dedicated private Redis namespace:

```text
room-access:credential:<roomId>:<credentialId>
room-access:credentials:<roomId>
room-access:audit:<roomId>
room-access:rotation-lock:<roomId>:<periodId>
```

Each credential record contains:

- opaque credential id and owner-visible label;
- mode, state, version, period, and schedule;
- password verifier parameters and salt;
- encrypted current and prepared plaintext, when reveal is enabled;
- masked hint suitable for owner lists;
- binding, activation, and expiry rules;
- created, prepared, activated, rotated, and revoked timestamps.

### Verification

Use Node's built-in `crypto.scrypt` or a maintained Argon2id dependency with
parameters calibrated to the deployment. Verification must:

- use a unique random salt per credential version;
- include a server-side pepper derived from the instance secret;
- run in a bounded worker pool so verification cannot starve file serving;
- use constant-time comparison;
- support parameter upgrades on the next successful verification;
- never log the candidate password.

Generated high-entropy secrets resist guessing, but custom passwords still need
a memory-hard verifier.

### Revealable generated passwords

The owner needs to distribute current and prepared passwords. Store revealable
plaintext encrypted with AES-256-GCM under a key derived with HKDF from a
dedicated instance master secret and the room id. The verifier remains separate
from the encrypted copy.

Every reveal:

- requires current owner or moderator authorization;
- should require recent account reauthentication for registered owners;
- returns `Cache-Control: no-store`;
- is excluded from logs, analytics, and error reporting;
- creates an audit event with actor and credential id only;
- never enters HTML source before the reveal action.

If the encryption master secret is lost or changed, existing password
verification may continue if its pepper is available, but reveal may fail.
The recovery action is to rotate credentials, never to weaken encryption.
Operators must back up the instance secret with room state.

User-supplied personal passwords may be configured as non-revealable. In that
mode only the verifier is stored, and the owner can replace but not recover the
value.

### Configuration defaults

Global configuration should contain policy defaults and limits, not individual
room passwords:

```json
{
  "allowRoomPasswordProtection": true,
  "roomPasswordDefaults": {
    "mode": "shared",
    "schedule": "calendar-month",
    "timezone": "UTC",
    "prepareDaysBefore": 7,
    "graceHours": 0,
    "grantScope": "browser"
  },
  "maxRoomAccessCredentials": 50,
  "roomAccessAuditLimit": 200,
  "roomPasswordRevealRequiresReauth": true
}
```

The generated password itself belongs in the protected room credential store.
It should not be written to `defaults.js`, environment variables, or the public
room configuration. An operator-managed static room policy in `.config.json`
may be supported later, but it should normalize into the same private credential
service rather than create a second verification path.

## HTTP and socket gate

### Browser entry

`GET /r/:roomId` performs access evaluation before rendering the room template.
If password access is missing, it renders a dedicated gate page containing:

- Dicefiles branding;
- **This room is protected**;
- one password field and **Enter room** button;
- optional browser/account grant scope;
- a neutral invalid-password message;
- no room name, owner, user count, activity, files, previews, or message data.

The password is submitted in the request body, never a URL, fragment, or query
parameter. After verification, the server creates a grant and redirects to the
clean room URL using POST/Redirect/GET.

The gate must work without loading the room application bundle or opening its
socket. This prevents a visual prompt from becoming the only barrier.

### API contract

Public access evaluation:

| Route | Purpose |
| --- | --- |
| `GET /api/v1/rooms/:id/access` | Return only whether the current principal requires a credential |
| `POST /api/v1/rooms/:id/access-grants` | Verify a password and create a period-bounded grant |
| `DELETE /api/v1/rooms/:id/access-grants/current` | Forget this browser/account grant |

Grant request:

```json
{
  "password": "value entered by the visitor",
  "scope": "browser"
}
```

Success:

```json
{
  "ok": true,
  "grant": {
    "scope": "browser",
    "expiresAt": "2026-09-01T00:00:00.000Z"
  }
}
```

Failure uses one generic response:

```json
{
  "error": {
    "code": "ROOM_ACCESS_DENIED",
    "message": "The room password was not accepted.",
    "requestId": "opaque-correlation-id"
  }
}
```

Do not reveal whether the value matched an expired, revoked, personal, or
prepared credential.

### Owner API

| Route | Scope | Purpose |
| --- | --- | --- |
| `GET /api/v1/rooms/:id/access-policy` | `room-access:read` | Read policy and credential metadata |
| `PATCH /api/v1/rooms/:id/access-policy` | `room-access:write` | Enable, disable, or change policy |
| `GET /api/v1/rooms/:id/access-credentials` | `room-access:read` | Paginated credential list without secrets |
| `POST /api/v1/rooms/:id/access-credentials` | `room-access:write` | Create shared, cohort, or personal credential |
| `PATCH /api/v1/rooms/:id/access-credentials/:credentialId` | `room-access:write` | Change label, schedule, limits, or state |
| `DELETE /api/v1/rooms/:id/access-credentials/:credentialId` | `room-access:write` | Revoke credential and grants |
| `POST /api/v1/rooms/:id/access-credentials/:credentialId/rotations` | `room-access:write` | Create an immediate or scheduled rotation |
| `POST /api/v1/rooms/:id/access-credentials/:credentialId/reveals` | `room-access:secrets` | Return current or prepared secret after reauthentication |
| `GET /api/v1/rooms/:id/access-audit` | `room-access:read` | Cursor-paginated privacy-safe events |

Automation keys do not receive `room-access:secrets` implicitly from
`room-access:read`, room ownership, or `mod:*`. Secret reveal is a distinct,
sensitive capability.

Mutation requests validate complete typed input at the route boundary. Error
responses use the normal stable API error shape. Lists are paginated from the
first release.

### Socket enforcement

Socket connection and resumption must call the same access evaluator as HTTP.
The server must not emit config, history, file lists, linked content, presence,
or room identity before authorization.

When protection is enabled, rotated, or revoked:

- increment the room authorization epoch;
- re-evaluate connected clients;
- send `access_required` without protected details;
- disconnect clients whose grants are no longer valid;
- allow the browser to return to the password gate.

Checking only the initial page route would leave WebSocket and resume paths open.

## Protect every content path

Room entry protection must also cover:

- finished-file downloads and byte ranges;
- generated previews, covers, and media assets;
- archive listings and extracted entries;
- comic and document reader endpoints;
- batch download and **Download All**;
- request-board attachments;
- chat history and room configuration;
- file-list, link-list, and request APIs;
- deep links and reader-resume state;
- upload key registration and upload completion;
- linked-room and federation source listings.

Resolve the upload or request to its source room, then evaluate access before
serving bytes or metadata.

Deduplicated physical storage does not merge room authorization. If identical
content is independently uploaded to an open room, that open room's upload
reference remains accessible; protection applies to the protected room's
references and metadata.

Use `Cache-Control: private, no-store` on the gate, grant, reveal, and sensitive
owner responses. Protected assets must not be stored in a shared public cache.

## Room Options experience

Add an **Access** tab or a clearly separated **Password protection** section.
It should feel like a community management feature, not a low-level server
setting.

### Protection card

- **Require a room password** toggle
- Requirement summary: **Password required in addition to invitations**
- Grant scope: **This browser** or **Signed-in account**
- Current period and exact end date
- Next rotation time in the community timezone
- Grace-period warning, if enabled
- Number of current grants, without identities unless policy permits

### Current community password

- masked password
- **Reveal** and **Copy** actions
- created/activated time
- **Rotate now** emergency action
- **Prepare replacement** when manual
- clear warning that rotation removes current visitor access

### Next password

Visible only once prepared:

- **Starts 1 September at 00:00 Europe/Kyiv**
- masked password with reveal/copy
- whether an owner has viewed it
- regenerate-before-activation action
- distribution checklist owned by the community

Regenerating a prepared value before activation does not affect current access,
but invalidates any already distributed copy. The confirmation must say this.

### Credentials table

One row per shared, cohort, or personal credential:

- label and type;
- current state;
- rotation schedule;
- current and next boundary;
- active grant count;
- last used time;
- reveal, rotate, suspend, and revoke actions.

Do not display raw passwords in the table. Reveal occurs in a focused,
no-cache dialog.

### Visitor experience

After entry, show a discrete lock indicator:

```text
Access valid until 1 September
```

It may include **Forget access on this device**. Do not repeatedly announce
protection in the room banner.

The gate must support paste, password managers, keyboard submission, visible
focus, accessible error messages, and a show/hide control. It must not impose
arbitrary composition rules on generated passphrases.

## Interaction with existing features

### Invite-only rooms and guest invites

- Password protection and invite-only access compose with `AND`.
- Existing invited accounts still enter the password unless they are
  owners/moderators.
- A guest invite pass satisfies only the invite gate.
- Owner UI explains both requirements before enabling the second gate.
- A future invite may explicitly grant password access for one period, but that
  must be a distinct access-invite type, not a silent change to existing links.

### Owners and moderators

Owners and moderators bypass password entry so they can recover the room.
Sensitive password reveal still requires recent owner reauthentication when
configured. A temporary anonymous room owner token may manage protection only
from the browser that owns the room.

### Accounts and personal credentials

A personal credential may bind on first use to a signed-in account. Binding
must be explicit in the creation form and irreversible without owner reset.
Account deletion or removal from the room revokes its account-scoped grants.

### Plugins and bots

Owner-installed room plugins already act as trusted room components and may use
an internal service grant tied to their installation id. They do not receive
the human password.

External automation needs normal room authorization or a dedicated,
owner-approved room service grant. A global API key alone must not bypass a
protected room. Service grants are independently revocable and never displayed
as human passwords.

### Cross-linking and federation

Protected source content must not appear in another room merely because
cross-linking or federation was previously enabled. The safest first release is
to block protected rooms as cross-link/federation sources.

A later release may add explicit protected-source delegation:

- separate source-owner opt-in;
- destination or peer capability bound to one room;
- revocation when the password policy changes;
- clear warning that destination viewers do not enter the source password;
- no transfer of human passwords between hosts.

The password itself is never a federation credential.

### Public directory and status

Protected rooms should be omitted from the public room directory by default.
If an owner opts into a locked listing, expose only the display information they
explicitly approve. Public status telemetry may aggregate the number of
protected rooms but must not expose their identities or credential activity.

### Deep links

A deep link stores its intent locally, sends the visitor through the gate, then
applies the intent only after access succeeds. The password never appears in the
deep link.

## Abuse resistance

Password verification is intentionally expensive, so rate limiting must happen
before the memory-hard verifier.

Use layered Redis-backed limits:

- per IP address;
- per room;
- per browser token;
- per account when signed in;
- instance-wide concurrency for password derivation.

Recommended behavior:

- small initial burst for typing errors;
- increasing backoff with jitter;
- generic `429` response with `Retry-After`;
- reset or decay counters after success;
- do not reveal whether a room has several credentials;
- record bounded failed-attempt aggregates, not candidate passwords.

Instance operators may enable a challenge after sustained abuse, but ordinary
communities should not see a CAPTCHA after one typo.

Use HTTPS in production. Set strict same-site cookies, validate CSRF tokens on
grant and owner mutation requests, and avoid referrer leakage from the gate.

## Audit and notifications

Retain a bounded privacy-safe audit:

- protection enabled, disabled, or policy changed;
- credential created, prepared, activated, suspended, revoked, or rotated;
- secret revealed;
- grant created or revoked;
- emergency rotation;
- repeated rate-limit activation;
- scheduler catch-up or failure.

Audit records include actor, credential id/label, timestamps, and outcome. They
exclude passwords, verifier material, browser tokens, account hashes, and raw IP
addresses from the room-owner view.

Optional webhooks:

- `room_access_password_prepared`
- `room_access_password_rotated`
- `room_access_policy_changed`
- `room_access_rate_limited`

These events contain no password. They may prompt an owner to sign in and copy
the new value. Automatic secret delivery to Discord, Telegram, or email should
be a separate explicit integration with its own threat model.

## Runtime consistency

Dicefiles may run several Node workers. Use Redis coordination:

- one lock per room, credential, and period;
- idempotent period identifiers;
- compare-and-set promotion of prepared credentials;
- authorization epoch published through the broker;
- expiring grants and rate limits;
- bounded rotation scheduler with retry.

All workers calculate the same period from schedule and timezone. Rotation
correctness must not depend on which worker receives the first visitor.

Clock health matters. Surface material clock skew in operator health checks and
store all authoritative instants in UTC.

## Failure and recovery behavior

| Failure | Required behavior |
| --- | --- |
| Rotation worker misses the boundary | Access evaluator rejects old period; scheduler catches up idempotently |
| Next password was never prepared | Generate current value under lock; alert owners; do not accept the old period |
| Redis is unavailable | Fail closed for new protected-room entry; do not guess from browser state |
| Existing grant lookup times out | Return retryable protected-access error without room content |
| Instance encryption key is lost | Verification/reveal behavior follows available key material; require controlled credential rotation |
| Owner rotates during active use | Increment epoch, disconnect stale clients, return them to gate |
| Timezone rules change | Recalculate future boundaries; never rewrite already activated period instants |
| Personal credential reaches activation limit | Generic denial; owner view shows limit reached |
| Credential is revoked | Remove accepted version, invalidate indexed grants, disconnect affected clients |
| Protection is disabled | Stop requiring grants; retain or purge credentials according to explicit owner choice |
| Protection is re-enabled | Require a newly confirmed credential; do not silently revive expired grants |

Disabling protection should offer:

- **Keep credentials disabled** — convenient for temporary reopening;
- **Delete credentials and grants** — irreversible cleanup.

## Implementation boundaries

Introduce focused modules:

```text
RoomAccessPolicy
  validates and evaluates non-secret room access rules

RoomCredentials
  creates, verifies, prepares, rotates, reveals, and revokes credentials

RoomAccessGrants
  creates and checks browser/account grants

RoomAccessScheduler
  prepares and promotes period credentials under Redis locks

RoomAccessGuard
  shared HTTP, socket, download, asset, upload, API, link, and federation gate

RoomAccessAudit
  bounded privacy-safe lifecycle records
```

Every protected route calls `RoomAccessGuard`. Do not duplicate password logic
inside page, socket, and download handlers.

Suggested internal contract:

```js
evaluateRoomAccess({
  room,
  account,
  browserToken,
  guestInviteToken,
  servicePrincipal,
  now
}) => {
  allowed,
  needsInvite,
  needsPassword,
  grantExpiresAt,
  reasonCode
}
```

The evaluator returns internal reason codes. Public callers deliberately
collapse sensitive distinctions into stable generic errors.

## Phased implementation

### Phase 0 — access inventory and contract

- Inventory every HTTP, socket, file, preview, archive, upload, link, and
  federation path that can expose room content.
- Define access policy, credential, period, grant, audit, and error schemas.
- Add route-level contract tests before introducing the prompt.

### Phase 1 — one generated non-rotating password

- Add private credential storage and slow verification.
- Add browser-scoped grants.
- Gate page, sockets, downloads, assets, APIs, and uploads through one guard.
- Add Room Options enable/reveal/rotate/disable flow.
- Block protected rooms from cross-linking and federation.

This validates that the protection boundary is complete before adding calendar
complexity.

### Phase 2 — monthly rotation

- Add calendar periods, IANA timezone selection, preparation window, scheduler,
  promotion locks, grant expiry, and emergency rotation.
- Show current/prepared secrets and rotation dates to owners.
- Add rotation audit and password-free webhooks.

### Phase 3 — cohort and personal credentials

- Add several credentials per room.
- Add account binding, activation limits, individual suspension/revocation, and
  paginated administration.
- Add optional account-scoped grants.

### Phase 4 — service grants and delegated integrations

- Add owner-approved plugin/automation service principals.
- Design protected cross-link/federation delegation separately.
- Consider explicit secure secret-distribution integrations only after access
  telemetry and owner workflows are mature.

## Test strategy

### Unit tests

- Period boundaries across months, leap years, daylight-saving changes, and
  fixed-day anchors.
- Prepared password is rejected before activation.
- Current password grants only until current period end.
- Previous password grace grants expire at grace end.
- Missed periods catch up without accepting stale versions.
- Emergency rotation invalidates old versions and prepared values.
- `inviteAccess AND passwordAccess` composition.
- Owners/moderators bypass entry but not sensitive reveal reauthentication.
- Personal binding and activation limits.
- Constant-time verifier comparison and parameter upgrade.
- Generic public errors for wrong, expired, prepared, and revoked values.

### Integration tests

- Anonymous browser enters once and refreshes without another prompt.
- A second browser must authenticate separately.
- Account-scoped access works across sessions only when enabled.
- Access disappears exactly at period end.
- HTTP gate exposes no room metadata.
- Socket handshake and resumption emit nothing before authorization.
- Direct download, preview, range, archive, reader, batch download, request
  image, file list, upload key, and deep link are all gated.
- Existing guest invite satisfies only the invite gate.
- Protection enabled or rotated disconnects stale clients.
- Protected room cannot leak through cross-link or federation.
- Plugin service grant works without possessing the human password.
- Redis restart, scheduler retry, concurrent rotation, and grant cleanup.

### Security tests

- Password never appears in URL, HTML source before reveal, logs, webhooks,
  metrics, audit payload, exported room config, or exception reports.
- CSRF protection on grant, reveal, rotation, and policy mutation.
- Rate limits are shared across workers and applied before `scrypt`/Argon2.
- Timing and response shapes do not distinguish credential states.
- Cache headers prevent shared caching of protected data.
- Revocation removes indexed grants without unbounded key scans.
- Invalid room ids and unauthorized room ids do not become enumeration oracles.

### UX acceptance

- An owner can enable monthly protection, copy the current password, and
  understand its expiry without reading documentation.
- Seven days before rotation, the owner can copy the prepared password without
  activating it.
- A community member enters once and is not interrupted until period end.
- At the next period, the old password and old grant no longer work.
- Emergency rotation clearly explains that active visitors will be removed.
- A room with multiple cohort credentials remains understandable on mobile and
  with keyboard or screen-reader navigation.

## Recommended first-release defaults

- Password protection disabled per room until an owner enables it.
- Global capability enabled unless an instance operator disables it.
- Shared generated password as the primary mode.
- Calendar-month rotation in the room's selected timezone.
- Seven-day preparation window.
- Zero-hour old-password grace.
- Browser-scoped grants.
- Owners and moderators bypass entry.
- Invite-only and password gates compose with `AND`.
- At least 80 bits of entropy for generated values.
- Memory-hard password verification with global concurrency limits.
- Maximum 50 credentials per room and bounded audit history.
- Protected rooms omitted from the public directory.
- Protected rooms blocked as cross-link and federation sources initially.
- No raw-password webhooks or automatic bot distribution.

## Decisions before implementation

1. Should a room default to the operator timezone, UTC, or ask the owner during
   enablement?
2. Should registered invitees be allowed to bypass the password as an explicit
   room option, or should the model remain strictly additive?
3. Is recent account reauthentication sufficient for secret reveal, or should
   two-factor-authenticated owners be required when 2FA is available?
4. Should custom owner-supplied passwords be revealable or verifier-only by
   default?
5. What verifier parameters are safe on the smallest supported Dicefiles host
   without creating a denial-of-service risk?
6. Should the prepared-password lead time be fixed at seven days or configurable
   from one through fourteen?
7. When a protected room is listed publicly by explicit opt-in, which room
   metadata is safe to show before authorization?
8. Should account-wide grants be included in the first release or follow
   personal credentials?

These decisions do not change the core contract: secrets remain private,
authorization is server-side and period-bounded, every content path uses one
guard, and rotation invalidates old grants predictably.
