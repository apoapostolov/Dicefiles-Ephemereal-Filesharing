# Documentation

Canonical product and contributor docs. Filenames use **FULL_CAPS** (except this index).

For room owners, start with the [core plugin guide](./CORE_PLUGINS.md). Developers
can follow the [API reference](../core/plugins/PLUGIN_API.md) and
[27-plugin cookbook](../core/plugins/PLUGIN_COOKBOOK.md). Provider-specific
operator instructions live under `../core/plugins/`.

## Choose a reading path

- **Use room bots:** [power-user guide](./CORE_PLUGINS.md), then provider setup as needed.
- **Build a plugin:** [API reference](../core/plugins/PLUGIN_API.md), [cookbook](../core/plugins/PLUGIN_COOKBOOK.md), then [event/installation guide](../core/plugins/DEVELOPING_PLUGINS.md).
- **Connect an agent:** [MCP setup and all 57 tools](../MCP.md), then [automation workflows](./ai_automation.md).
- **Read offline:** [power-user HTML](./handbooks/hobbyfiles-core-plugins-1.5.0.html) or [developer HTML](./handbooks/hobbyfiles-plugin-developer-1.5.0.html). Download editions from [release 1.5.0](https://github.com/apoapostolov/Hobbyfiles/releases/tag/v1.5.0).

## Reference index

| Document | Purpose |
| -------- | ------- |
| [INTRODUCTION.md](./INTRODUCTION.md) | What Hobbyfiles is, use cases, getting started |
| [CORE_PLUGINS.md](./CORE_PLUGINS.md) | All 27 core bots: settings, practical uses, review actions and troubleshooting |
| [../core/plugins/PLUGIN_API.md](../core/plugins/PLUGIN_API.md) | In-process context API 2, independent of REST and MCP versions |
| [../core/plugins/PLUGIN_COOKBOOK.md](../core/plugins/PLUGIN_COOKBOOK.md) | Examples from every bundled plugin and complete extension modules |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Dev setup, PR expectations, quality bar |
| [FUTURE_DEVELOPMENT_PLAN.md](./FUTURE_DEVELOPMENT_PLAN.md) | Product backlog — checked = shipped, open = proposed |
| [AUDIT_2026-10-14.md](./AUDIT_2026-10-14.md) | Maintenance findings, dependency results, MCP decision, and priorities |
| [FEDERATION.md](./FEDERATION.md) | Shipped trusted-host federation protocol, setup, and security model |
| [MULTI_VOLUME_STORAGE.md](./MULTI_VOLUME_STORAGE.md) | Multi-volume placement, migrations, drain/rebalance and rollback |
| [PASSWORD_PROTECTED_ROOMS.md](./PASSWORD_PROTECTED_ROOMS.md) | Rotating shared, cohort and personal room access credentials |
| [MULTI_HOST_REMOTE_IMPORTS.md](./MULTI_HOST_REMOTE_IMPORTS.md) | Gofile, fair scheduling and optional guarded remote import adapters |
| [UI_STYLE.md](./UI_STYLE.md) | Room UI components and styling rules |
| [ENVIRONMENT.md](./ENVIRONMENT.md) | Private environment files, flags, provider keys and precedence |
| [THEMES.md](./THEMES.md) | 34 appearance palettes, token roles and theme development |
| [TORRENTS.md](./TORRENTS.md) | Magnet/torrent ingestion, contents, tracker availability, artwork and discovery limits |
| [DOCKER.md](./DOCKER.md) | Build/run recipe, persistent volumes and GHCR publication |
| [AI_UI_SKILLS.md](./AI_UI_SKILLS.md) | Agent guide for UI audit / polish / themes |
| [PERF_NOTES.md](./PERF_NOTES.md) | Virtualization and performance notes (1.4.x) |
| [ACHIEVEMENT_SYSTEM.md](./ACHIEVEMENT_SYSTEM.md) | Profile trophy / achievement design |
| [ARCHIVE_VIEWER.md](./ARCHIVE_VIEWER.md) | In-browser archive browser spec |
| [MESSAGE_REMOVAL.md](./MESSAGE_REMOVAL.md) | Moderator message removal behavior |
| [ai_automation.md](./ai_automation.md) | Current REST/MCP workflows, durable bot jobs, review and sessions |
| [REMOTE_HOST_LIBRARY_RESEARCH.md](./REMOTE_HOST_LIBRARY_RESEARCH.md) | Research: embeddable multi-host download libs (not a standalone product) |
| [../dev/README.md](../dev/README.md) | AI/human development workflow, generated files, review, and release checks |
| [../skills/hobbyfiles-ops/SKILL.md](../skills/hobbyfiles-ops/SKILL.md) | Operator skill for AI agents: install, config, service, upgrade, backup, MCP wiring, room bots, diagnostics |
| [../SECURITY.md](../SECURITY.md) | Private vulnerability reporting and repository security policy |

## Archived (historical only)

Completed overhaul plans and withdrawn CI proposals: **[archive/](./archive/)**.
