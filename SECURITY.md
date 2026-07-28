# Security Policy

## Reporting A Vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion,
changelog, screenshot, or log excerpt.

Use GitHub's private vulnerability reporting for this repository from the
repository **Security** tab. If private reporting is unavailable, contact the
maintainer through an existing trusted private channel and include only the
minimum evidence needed to reproduce the issue.

Useful reports include:

- affected version or commit
- impact and required attacker access
- minimal reproduction steps
- whether real credentials or user data may have been exposed
- a suggested mitigation, if known

Do not upload real private files, room links, invite/status tokens, API keys,
bot credentials, passwords, IP addresses, or account details as evidence.

## Sensitive Areas

Dicefiles handles untrusted uploads, archives, remote downloads, room access,
automation keys, bot credentials, webhooks, and native preview tools. Reports
about authorization bypass, path traversal, unsafe archive extraction, SSRF,
XSS, command injection, denial of service, secret exposure, or cross-room data
leakage are especially important.

## Repository Hygiene

- Keep secrets in local `.config`, `.config.json`, environment variables, or a
  secret manager.
- Never commit uploads, databases, Redis persistence, runtime logs, browser
  captures, certificates, or local provider configuration.
- Use placeholder values in examples and tests.
- If a secret leaks, revoke or rotate it first, then remove it from the current
  tree and Git history as appropriate.

Security fixes should include regression coverage when a safe automated test
can represent the failure without embedding sensitive data.
