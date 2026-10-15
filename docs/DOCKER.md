# Docker deployment

The image contains Node.js 24, production dependencies, compiled browser assets,
and native preview tools. It runs as UID/GID 1000 with `tini` for signal forwarding
and child reaping. Redis is a separate persistent service. Windows Docker Desktop
must use Linux containers; ordinary Linux Docker Engine works too.

## Cook the image locally

From the repository root:

```bash
docker build --pull -t dicefiles:local .
cp .env.docker.example .env.docker
chmod 600 .env.docker
openssl rand -hex 32
```

Put the generated value in `DICEFILES_SECRET` in `.env.docker`. Keep the file
private. Optional provider keys go in the same file. Do not pass credentials as
build arguments; `.dockerignore` allows only public application build inputs.
The build installs dev dependencies in a separate build stage, compiles the
client, and copies production dependencies into the runtime stage.

```bash
docker compose --env-file .env.docker up -d --no-build
docker compose --env-file .env.docker ps
curl -fsS http://127.0.0.1:8080/healthz
```

The site opens at `http://127.0.0.1:8080`. In Docker Desktop, it appears in the
Containers view under **dicefiles**; expand the project and open the app's port.
To build and start in one step, use `up -d --build`. Stop with `down`; the named
volumes remain. Avoid `down -v` unless you intend to erase this deployment.

## Use a GHCR image

The package path is:
`ghcr.io/apoapostolov/dicefiles-ephemereal-filesharing:TAG`.
Use a published tag or immutable digest; a tag is not available until publication
succeeds. Set `DICEFILES_IMAGE` in `.env.docker` to that reference, then run:

```bash
docker compose --env-file .env.docker pull
docker compose --env-file .env.docker up -d --no-build
```

The unreleased development channel is `:preview`. It includes the October
maintenance, themes, movie playback/matching, torrent metadata and upload dialog changes. It is separate
from the last tagged source release, v1.4.6; pin its digest for reproducible use.

The October 16 validated preview, including movie playback, automatic title
matching and relaxed torrent availability checks, has digest
`sha256:b583054fb63ed85814661075d7dbf83641babb268c53c70c320a77514f0fd500`.
Use `ghcr.io/apoapostolov/dicefiles-ephemereal-filesharing@sha256:b583054fb63ed85814661075d7dbf83641babb268c53c70c320a77514f0fd500`
to pin that build instead of following the moving channel.
The [publication run](https://github.com/apoapostolov/Dicefiles-Ephemereal-Filesharing/actions/runs/38808749637)
builds source commit `e8407ea` for AMD64 and ARM64, with SBOM and provenance.

For a private package, authenticate with a classic GitHub token that has
`read:packages`, using `docker login ghcr.io -u YOUR_USER --password-stdin`.
Public packages can be pulled without authentication.

## Publish to GHCR

The **Build container** GitHub Actions workflow builds and smoke-checks the image
on pull requests. After this workflow is in the repository, run it manually with
`publish=true` and a tag. It uses the repository's `GITHUB_TOKEN` with
`packages:write`, publishes `linux/amd64` and `linux/arm64`, and attaches SBOM and
provenance. It does not publish automatically from pull requests.
Smoke and multi-architecture builds retain separate caches between runs.

From an authenticated GitHub CLI checkout:

```bash
gh workflow run container.yml --ref main -f publish=true -f tag=preview
gh run list --workflow container.yml
```

Wait for the publishing run to succeed before using the tag. Docker registry
login on your workstation is not required for Actions publication.

Local publication requires a classic GitHub token with `write:packages`:

```bash
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_USER --password-stdin
docker tag dicefiles:local ghcr.io/apoapostolov/dicefiles-ephemereal-filesharing:preview
docker push ghcr.io/apoapostolov/dicefiles-ephemereal-filesharing:preview
```

Do not use an existing released version tag for an unreleased working tree.
The OCI source label associates the image with the source repository. Package
visibility is controlled separately in GitHub Packages. See GitHub's
[Container registry guide](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

## Data, configuration and upgrades

- `dicefiles-data:/data` holds uploads, generated private `.config.json`, audit
  logs and any env file explicitly mounted there. Keep the generated status token
  and federation keys private. Do not mount over `/opt/dicefiles`.
- `redis-data:/data` holds Redis AOF and snapshots. Redis has no published host
  port. The named volume is separate from the app's volume despite the same
  in-container path.
- Environment settings override JSON configuration. See [ENVIRONMENT.md](./ENVIRONMENT.md).
  Advanced nested JSON settings can be copied into the app volume with
  `docker compose --env-file .env.docker cp .config.json app:/data/.config.json`,
  followed by `restart app`. Stop the app first when replacing existing config.
  Preserve its generated private fields. A directory mount works too; a
  single-file mount is unsuitable for Dicefiles' atomic config replacement.
- New named volumes inherit UID 1000 ownership. For a bind mount, create it with
  that ownership (`chown 1000:1000 ./dicefiles-data`) before starting. Do not
  recursively change ownership of unrelated host directories.
- To upgrade: back up both volumes and the env file, pull/build the new image,
  then `up -d --no-build`. Confirm `/healthz` and a room/upload/reader flow. Roll
  back by restoring the previous image reference; do not roll back Redis data
  separately from uploads.
- To expose the site beyond this computer, put a TLS reverse proxy in front of
  the loopback port and set `DICEFILES_PUBLIC_BASE_URL`. The example does not
  open the host's external interfaces.

## Preview sandbox limitations

The default Compose policy is non-root, read-only code, no additional Linux
capabilities and `no-new-privileges`. The image sets
`DICEFILES_NATIVE_TOOLS=false`: external metadata/preview/extraction commands
are disabled. Firejail can treat a container as an existing sandbox and skip
nested isolation, so a successful exit alone is not sufficient proof of safety.
The same automatic detection can occur on WSL. A fixture rendering successfully
there proves preview functionality, not additional per-file isolation. Validate
isolation on the actual deployment host before accepting untrusted uploads.

File sharing, torrent metadata, Sharp image previews and browser readers remain
available. New server-generated PDF/book/video covers and native RAR/7Z extraction
are unavailable by default. ZIP features that use bounded JavaScript parsing
remain available. Native tools are installed so operators can validate a dedicated
sandbox policy later. The image includes Debian's non-free `unrar` package;
its upstream license applies separately from Dicefiles' MIT source license.

Public tracker/DHT/peer metadata discovery uses Node networking and does not
require native tools. Set `DICEFILES_TORRENT_DISCOVERY=false` in `.env.docker`
to disable that outbound traffic; see [torrent metadata](./TORRENTS.md).

The example environment disables torrent payload playback because Compose uses
a 512 MiB memory-backed `/tmp`. For payload streaming, provide a disk-backed
temporary cache with space for up to two 4 GiB sessions before setting
`DICEFILES_TORRENT_PLAYBACK=true`. Keep uploaded-video playback enabled; it does
not use this torrent cache. TMDB/TVDB/Trakt credentials may be placed in the
private `.env.docker`; see [movies and subtitles](./MOVIES.md).

For untrusted/public uploads needing the full native preview stack, use the
host deployment with functioning Firejail, or validate a dedicated container
sandbox policy before enabling `DICEFILES_NATIVE_TOOLS=true`. Do not solve
preview errors with privileged mode or a mounted Docker socket.
`DICEFILES_JAIL=false` explicitly opts out of the per-file sandbox and is for
trusted local data only. Time/output limits do not replace process isolation.

## Standalone MCP in the image

MCP remains a separate process. Run the same image with the command
`node /opt/dicefiles/scripts/mcp-server.js` and supply the MCP settings from
[MCP.md](../MCP.md). For stdio clients use `docker run --rm -i --no-healthcheck …`
without `-t`; attach it to the app's Compose network and use
`DICEFILES_BASE_URL=http://app:8080`. An HTTP MCP service needs its own port,
health policy, incoming bearer token and explicit host/origin allowlists.
