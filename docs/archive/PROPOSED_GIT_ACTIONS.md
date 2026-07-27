# Proposed GitHub Actions for Dicefiles

---

## What is a GitHub Action? (For the complete beginner)

A **GitHub Action** is an automated script that GitHub runs for you, on its own servers,
whenever something happens in your repository. That "something" is called a **trigger**
or **event**. Common triggers are:

- **You push a commit** — GitHub runs your tests automatically.
- **Someone opens a pull request** — GitHub checks the code before you merge it.
- **Once a week, at a fixed time** — GitHub runs a security scan even if no one pushed.
- **You click "Run" manually** — useful for deploys or one-off tasks.

The script lives in a YAML file inside `.github/workflows/` in your repo. You already
have one: `.github/workflows/security.yml`. Open it — the structure is the same for
everything in this document.

### Key vocabulary

| Term                | Plain-English meaning                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| **Workflow**        | One YAML file = one workflow. A repo can have many.                           |
| **Job**             | A named block inside a workflow that runs on a virtual machine.               |
| **Step**            | One command or action inside a job. Steps run top to bottom.                  |
| **Runner**          | The virtual machine GitHub spins up to execute your job.                      |
| **Action**          | A reusable unit of work, like `actions/checkout` (fetches your code).         |
| **Trigger (`on:`)** | The event(s) that start the workflow.                                         |
| **Secret**          | A sensitive value (API key, password) stored in GitHub Settings, not in code. |

### How to read a workflow file

```yaml
name: My First Workflow # Name shown in the GitHub UI

on: # What triggers this workflow
  push: #   ← any push to any branch
    branches: [main] #   ← narrow it: only pushes to main

jobs: # Work to do
  test: # ← job name (you choose it)
    runs-on: ubuntu-latest # ← which OS to use
    steps:
      - uses: actions/checkout@v4 # ← fetch the repo files
      - uses: actions/setup-node@v4 # ← install Node.js
        with:
          node-version: 18
      - run: npm ci # ← shell command: install deps
      - run: npm test # ← shell command: run tests
```

That's a complete, working CI workflow. Save that file to
`.github/workflows/ci.yml` and every push to `main` will run your tests in the cloud.

---

## Workflow 1 — Continuous Integration (CI) Tests

**File**: `.github/workflows/ci.yml`
**Status**: Proposed

### What it does

Every time you push a commit or open a pull request, GitHub runs the full Jest test
suite automatically. If any test fails, you see a red ✗ on the commit before you merge.
This catches broken code before it reaches production.

### Why you want it

- You push at 2 AM and forget to run tests locally.
- A collaborator or an AI agent changes something — tests run automatically so you know
  immediately if something broke.
- GitHub shows a green ✓ or red ✗ next to every commit, making it obvious what's safe
  to deploy.

### Proposed workflow

```yaml
name: CI — Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Node 18
        uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm

      - name: Install dependencies
        run: npm ci --legacy-peer-deps

      - name: Run tests
        run: npm test
```

---

## Workflow 2 — Security Audit (already exists)

**File**: `.github/workflows/security.yml`
**Status**: Implemented

This workflow already runs `npm audit --audit-level=high` on every push to `main` and on
a weekly schedule. It catches newly disclosed vulnerabilities in npm packages even when
no code changes.

If the audit finds a high or critical vulnerability, the job fails and GitHub sends you
an email.

---

## Workflow 3 — Automatic Release on Version Tag

**File**: `.github/workflows/release.yml`
**Status**: Proposed

### What it does

When you push a git tag like `v1.3.0`, this workflow:

1. Builds the webpack bundle.
2. Runs all tests.
3. Creates a GitHub Release automatically with release notes from `CHANGELOG.md`.

### Why you want it

Right now, creating a release requires several manual steps: build, test, tag, push,
write release notes, publish. This workflow does all of that for you whenever you push
a version tag.

### Proposed workflow

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*" # triggers on tags like v1.3.0, v2.0.0, etc.

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write # needed to create a GitHub Release

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm

      - name: Install dependencies
        run: npm ci --legacy-peer-deps

      - name: Run tests
        run: npm test

      - name: Build webpack bundle
        run: node ./node_modules/webpack-cli/bin/cli.js --mode=production

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true # auto-generates from commit messages
          # Or use a file: body_path: CHANGELOG_SECTION.md
```

### How you'd use it

```bash
git tag -a v1.3.0 -m "v1.3.0 — Security hardening"
git push origin v1.3.0
# GitHub Actions takes it from here.
```

---

## Workflow 4 — Stale Issue / PR Cleanup

**File**: `.github/workflows/stale.yml`
**Status**: Proposed (low priority)

### What it does

After 60 days of no activity, GitHub automatically adds a "stale" label to open issues
and pull requests. After another 7 days of silence, it closes them with a polite message.

### Why you want it

If you are the only contributor for now, this is optional. It becomes useful once other
people start opening issues or PRs because old, abandoned items pile up fast.

### Proposed workflow

```yaml
name: Stale Issues and PRs

on:
  schedule:
    - cron: "30 1 * * *" # runs daily at 01:30 UTC

jobs:
  stale:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      pull-requests: write

    steps:
      - uses: actions/stale@v9
        with:
          days-before-stale: 60
          days-before-close: 7
          stale-issue-message: >
            This issue has been inactive for 60 days.
            It will be closed in 7 days unless there is new activity.
          stale-pr-message: >
            This PR has been inactive for 60 days and will be closed in 7 days.
          exempt-issue-labels: "pinned,in-progress"
```

---

## Workflow 5 — Node Version Compatibility Check

**File**: `.github/workflows/compat.yml`
**Status**: Proposed

### What it does

Runs the test suite on both Node 18 (current production requirement) and Node 20 (next
LTS). This tells you whether Dicefiles is ready for a Node upgrade before you actually
do it.

### Proposed workflow

```yaml
name: Node Compatibility

on:
  push:
    branches: [main]
  schedule:
    - cron: "0 6 * * 1" # every Monday at 06:00 UTC

jobs:
  compat:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node: [18, 20, 22] # test on three versions in parallel

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm

      - run: npm ci --legacy-peer-deps
      - run: npm test
```

The matrix creates three parallel jobs — one per Node version — and shows you which
versions pass and which don't.

---

## Workflow 6 — Dependency Update Bot

**File**: GitHub UI setting (no YAML needed)
**Status**: Proposed

### What it does

Dependabot is a free GitHub feature that:

- Scans `package.json` weekly for outdated or vulnerable npm packages.
- Opens a pull request for each update with a changelog link.
- You review and merge (or dismiss) each PR.

It is NOT a GitHub Actions workflow — it is enabled by creating a `.github/dependabot.yml`
configuration file:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
    ignore:
      # Only major upgrades that have been vetted manually
      - dependency-name: "webpack"
        update-types: ["version-update:semver-major"]
```

### Why you want it

Security patches land in npm packages every week. Without automation, you only find out
when `npm audit` screams at you. Dependabot creates a PR so you can review and merge
security fixes in one click.

---

## Workflow 7 — Lint / Code Style Check

**File**: `.github/workflows/lint.yml`
**Status**: Proposed (requires setting up ESLint first)

### What it does

Runs ESLint (a JavaScript style checker) on every push and PR. Fails the workflow if
code style rules are violated, so style issues never merge into `main`.

### Why it matters for a vibe-coder

AI agents (and you) write code fast. ESLint catches things like:

- Forgetting `"use strict"`
- Unused variables that will confuse future readers
- `==` instead of `===` (a very common JS footgun)
- Unreachable code

### Setup summary

1. `npm install --save-dev eslint`
2. `npx eslint --init` (interactive setup — choose "problems only" to start minimal)
3. Add the workflow:

```yaml
name: Lint

on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
      - run: npm ci --legacy-peer-deps
      - run: npx eslint .
```

---

## Recommended Starting Order

If you want to add GitHub Actions incrementally, this is the suggested order from
highest to lowest immediate value:

1. **CI Tests** (Workflow 1) — most valuable; catches broken commits immediately.
2. **Security remains** (already done) — no action needed.
3. **Release automation** (Workflow 3) — saves the most manual effort per release.
4. **Dependabot** (Workflow 6) — passive protection; set it and forget it.
5. **Node compat matrix** (Workflow 5) — useful before the next Node LTS upgrade.
6. **Lint** (Workflow 7) — add when code style consistency becomes important.
7. **Stale cleanup** (Workflow 4) — add if others start collaborating.

---

## Common Pitfalls

| Pitfall                                 | Solution                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Workflow never runs**                 | Check the `on:` section — branch name must match exactly (`main` vs `master`).                                   |
| **"Permission denied" on checkout**     | Usually not an issue with public repos; for private ones, check repository Settings → Actions → Permissions.     |
| **`npm ci` fails with peer-dep error**  | Add `--legacy-peer-deps` as this project requires: `npm ci --legacy-peer-deps`.                                  |
| **Test fails in CI but passes locally** | Node version mismatch — pin to `node-version: 18` in the workflow.                                               |
| **Secrets show up in logs**             | Never `echo $SECRET`. Use `${{ secrets.MY_KEY }}` in workflow YAML; GitHub automatically redacts them from logs. |
| **Workflow file not found**             | File must be in `.github/workflows/` (two levels deep), not just `.github/`.                                     |
| **Job runs every minute**               | Cron syntax: `"* * * * *"` = every minute. Use `"0 6 * * 1"` for weekly Monday 6 AM.                             |

---

## Where to Learn More

- [GitHub Actions quickstart](https://docs.github.com/en/actions/quickstart) — official 10-minute intro
- [Workflow syntax reference](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions) — every YAML field explained
- [GitHub Actions Marketplace](https://github.com/marketplace?type=actions) — thousands of pre-built actions
- [Understanding secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions) — how to store API keys safely
