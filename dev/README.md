# AI Development Guide

This directory contains the small, project-specific operating scaffold used by
AI-assisted and human development. `AGENTS.md` is the entry point and remains
authoritative when guidance conflicts.

| Document | Use |
| --- | --- |
| [DEV_SERVER_WORKFLOW.md](./DEV_SERVER_WORKFLOW.md) | Stable WSL service, rebuild, restart, and health checks |
| [GENERATED_FILES.md](./GENERATED_FILES.md) | Source-to-output mappings and regeneration rules |
| [CODE_REVIEW_CHECKLIST.md](./CODE_REVIEW_CHECKLIST.md) | Dicefiles-specific correctness, security, UI, and operations review |
| [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) | User-testing handoff and public release checks |
| [DECISION_RECORD_TEMPLATE.md](./DECISION_RECORD_TEMPLATE.md) | Template for durable architectural decisions |

Existing canonical files are reused instead of duplicated:

- Product work and future scope: `docs/FUTURE_DEVELOPMENT_PLAN.md`
- Contributor setup and pull requests: `docs/CONTRIBUTING.md`
- User-visible release history: `CHANGELOG.md`
- Operator and API documentation: `README.md`, `API.md`, and `MCP.md`
- UI direction: `docs/UI_STYLE.md` and `docs/AI_UI_SKILLS.md`

Do not add personal interaction profiles, agent self-reviews, local development
logs, credentials, uploaded files, or machine/browser state to this public
repository.
