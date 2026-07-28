# Dicefiles Federation

Dicefiles federation connects independently operated Dicefiles hosts without a
shared database, shared Redis instance, or global user directory. A destination
room may display and download files from an explicitly allowed source room on a
trusted peer. Chat, accounts, moderation records, room membership, request-board
entries, plugins, and private room names do not federate.

Federation is disabled by default. Enabling the instance only makes discovery
available; both an operator-level peer record and a room-level opt-in are still
required before any file metadata or bytes can cross hosts.

## Standards and design choices

Dicefiles does not implement its own request-signature format.

- **RFC 9421 HTTP Message Signatures** authenticate every peer API request.
  Requests cover the method, target URI, authority, content digest when present,
  creation and expiry times, and a one-time nonce.
- **RSA-3072 with RSASSA-PKCS1-v1_5/SHA-256** is the instance identity
  algorithm supported end to end by Fedify's RFC 9421 signer and verifier.
  Public keys are published in JWK and PEM form; private keys remain local.
- **ActivityStreams 2.0** types are used for optional change notifications.
  Dicefiles does not expose private rooms as public social actors and is not a
  general-purpose ActivityPub server.
- **Matrix-inspired bilateral trust** means operators pin peers by identifier,
  canonical origin, and key. Keys are never fetched from an arbitrary URL found
  in a request.
- **OCI-inspired transfer rules** use immutable file identifiers, `HEAD`, byte
  ranges, explicit lengths, and content digests when one is known.

The implementation uses Fedify's maintained RFC 9421 implementation for signing
and verification. Dicefiles owns only its domain-specific authorization and file
transport contract.

## Trust model

An operator adds a peer to `.config.json`:

```json
{
  "federation": {
    "enabled": true,
    "publicBaseUrl": "https://files.example.org",
    "peerId": "example-files",
    "displayName": "Example Files",
    "peers": [
      {
        "peerId": "friends-files",
        "baseUrl": "https://files.friends.example",
        "keyId": "https://files.friends.example/federation/actor#main-key",
        "publicKeyJwk": {
          "kty": "RSA",
          "alg": "RS256",
          "n": "replace-with-the-peer-modulus",
          "e": "AQAB"
        },
        "allowedRooms": ["public-releases"]
      }
    ]
  }
}
```

`allowedRooms` is the maximum inbound authority granted to that peer. A room
must also enable `allowFederation`. Invite-only rooms require the separate
`allowPrivateFederation` switch. The destination must independently add a
federated-room link. No peer can enumerate rooms.

Use HTTPS in production. Plain HTTP and private-network destinations are rejected
unless the peer explicitly opts into them for a local or laboratory deployment.
Redirects are never followed by federation requests.

## Discovery

`GET /.well-known/dicefiles-federation` is public when federation is enabled.
It contains only:

- protocol name and version;
- instance peer identifier and display name;
- canonical origin and software version;
- actor and public-key identifiers;
- public RSA-3072 JWK;
- supported capabilities and endpoint templates.

Discovery never lists rooms, files, users, configured peers, or private
capabilities. `GET /federation/actor` exposes the same public identity as an
ActivityStreams `Service` document. This makes the identity understandable to
existing federation tooling without granting ActivityPub inbox access.

## Peer API

All routes below require a valid RFC 9421 signature from a configured peer:

| Route | Purpose |
| --- | --- |
| `GET /api/federation/v1/hello` | Verify bilateral trust and negotiate capabilities |
| `GET /api/federation/v1/rooms/:roomId` | Read privacy-safe room metadata after authorization |
| `GET /api/federation/v1/rooms/:roomId/files` | Cursor-paginated finished files |
| `HEAD /api/federation/v1/files/:key` | Size, media type, range, expiry, and digest metadata |
| `GET /api/federation/v1/files/:key` | Stream bytes, including one RFC 9110 byte range |
| `POST /api/federation/v1/inbox` | Receive idempotent ActivityStreams cache-invalidation events |

Successful JSON responses include `protocolVersion`. Errors use:

```json
{
  "error": {
    "code": "FEDERATION_ROOM_DENIED",
    "message": "This peer is not allowed to read that room.",
    "requestId": "opaque-correlation-id"
  }
}
```

Codes are stable; messages are for people and may improve over time. Room and
file misses deliberately use the same public `404` response so an unauthorized
peer cannot probe existence.

### File-list shape

Only completed, non-hidden uploads are returned:

```json
{
  "protocolVersion": "1.0",
  "room": { "id": "public-releases", "name": "Releases" },
  "files": [
    {
      "key": "opaque-file-key",
      "name": "dicefiles-1.5.0.zip",
      "size": 123456,
      "type": "application/zip",
      "uploadedAt": "2026-07-28T12:00:00.000Z",
      "expiresAt": "2026-08-02T12:00:00.000Z",
      "digest": null
    }
  ],
  "nextCursor": null
}
```

Uploader identity, IP address, account, room membership, moderation state,
storage paths, plugin credentials, and internal Redis values are never included.
The source host's expiry is authoritative. A destination must stop presenting a
file after that time even if its cache has not refreshed.

## Destination links

A federated link is stored separately from local `linkedRooms`:

```json
{
  "peerId": "friends-files",
  "roomId": "public-releases",
  "name": "Friends / Releases",
  "visibility": "all",
  "rules": {
    "nameIncludes": "dicefiles",
    "extensions": ["zip"],
    "maxAgeHours": 168
  }
}
```

The destination fetches remote metadata server-to-server and exposes a local
streaming proxy URL. Browser clients never receive peer credentials or contact
the source directly. Existing linked-room visibility and filtering rules apply
again at the destination.

## Replay, limits, and failure behavior

- Signatures expire after 60 seconds.
- Every signed request includes a cryptographically random nonce. Used nonces are
  rejected for five minutes and recorded in Redis across workers.
- JSON bodies and responses have strict size limits and schema validation.
- List pages are bounded and cursor based.
- Per-peer rate limits, stream concurrency, timeouts, and a circuit breaker
  protect the source and destination.
- Transport retries apply only to idempotent requests and use bounded backoff.
- Invalid signatures, replay attempts, authorization failures, peer state
  changes, and transfer failures are written to the structured audit stream.
- A failed peer never prevents local files or another healthy peer from loading.

Remote-link status is one of `active`, `unreachable`, `denied`, `missing`,
`key-invalid`, `protocol-mismatch`, or `circuit-open`. Status is descriptive and
does not leak the source's private room inventory.

## Key lifecycle

The first start with federation enabled generates an RSA-3072 key pair and writes
it to `.config.json`. The private JWK is secret and must not be committed,
logged, returned by an API, or sent to a browser.

Automatic or guided key rotation is not shipped yet. Until rotation tooling is
available, operators must coordinate any replacement identity and update every
peer's pinned public key out of band. A changed, unpinned key is a hard failure,
not trust-on-first-use; Dicefiles never silently trusts a newly discovered key.

## Out of scope

- automatic public peer discovery or a global Dicefiles directory;
- transitive or multi-hop room linking;
- cross-host accounts, membership, chat, moderation, or request boards;
- running a remote host's plugins;
- copying files into destination storage unless an operator explicitly requests
  a future mirror/import action;
- third-party file-locker imports (Mega.nz, Pixeldrain, Gofile, and similar).

That final item is the separate **multi-host remote import** proposal. Federation
trusts another Dicefiles operator; remote import treats an external file host as
an untrusted download source. They intentionally use different credentials,
SSRF rules, metadata, and lifecycle controls.

## References

- W3C ActivityPub Recommendation: https://www.w3.org/TR/activitypub/
- RFC 9421 HTTP Message Signatures: https://www.rfc-editor.org/rfc/rfc9421.html
- Matrix server-to-server specification: https://spec.matrix.org/latest/server-server-api/
- OCI Distribution Specification: https://specs.opencontainers.org/distribution-spec/
- Fedify documentation: https://fedify.dev/
