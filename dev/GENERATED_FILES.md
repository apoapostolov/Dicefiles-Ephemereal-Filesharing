# Generated File Rules

Edit source, then regenerate. Do not hand-edit browser bundles or their source
maps.

## Source To Output Map

| Canonical source | Generated output |
| --- | --- |
| `client/**/*.js` and `entries/**/*.js` | `static/*.js`, lazy chunks, license files, and maps |
| `entries/css/**/*.css` and bundled fonts | `static/*.css`, hashed `static/s~*` assets, and maps |
| `node_modules/pdfjs-dist/build/pdf.worker.mjs` | `static/pdf.worker.js*` |
| `webpack.config.js` and the full browser asset graph | `lib/clientversion.js` |

Run the only supported production generator:

```bash
yarn prestart
```

`static/404.jpg`, `static/HAL9000.svg`, `static/loader.png`, and
`static/.gitignore` are hand-maintained source files. Treat other generated
JavaScript, CSS, maps, license files, numeric chunks, vendor chunks, and hashed
assets as build output.

## Rules

- Change `client/`, `entries/`, or `webpack.config.js`, then run `yarn prestart`.
- Commit a generated file only with the source change that produced it.
- Never restore stale bundles over a newer source tree.
- Review generated diffs for unexpected third-party code or embedded local
  configuration; `.gif-providers.local.json` must never be committed.
- Do not add all ignored `static/` output blindly. Follow the existing
  `static/.gitignore` policy and the repository's tracked-output convention.
- `node_modules/`, coverage, browser reports, uploads, logs, and packaged
  tarballs are disposable local artifacts, not distributable source.

Before a handoff or release, a clean `yarn prestart` is the source-of-truth
staleness check.
