# Dicefiles Achievement System

## Goals
- Turn user profile pages into a "trophy room".
- Reward both consistency (file count) and volume (uploaded bytes).
- Keep progression non-linear (mixed x2, x5, x10 style jumps) instead of simple base-10 ladders.
- Show both unlocked achievements and locked (greyed) upcoming milestones.

## Achievement Axes

### 1) File Count Achievements (Archivist)
Milestones:
- 10, 25, 50, 100, 250, 500
- 1k, 2.5k, 5k, 10k, 25k, 50k
- 100k, 250k, 500k, 1M files

Rationale:
- Early milestones unlock quickly for onboarding.
- Mid and late milestones alternate x2/x5-like jumps.

### 2) Uploaded Data Achievements (Vaultkeeper)
Milestones:
- 50MB, 100MB, 250MB, 500MB
- 1GB, 2GB, 5GB, 10GB, 25GB, 50GB, 100GB, 250GB, 500GB
- 1TB, 2TB, 5TB, 10TB, 25TB, 50TB, 100TB, 250TB, 500TB
- 1PB, 2PB, 5PB, 10PB

Rationale:
- Progresses through realistic long-term storage scales.
- Includes petabyte-era milestones for very large archives.

## UI Behavior
- Each achievement card includes:
  - icon
  - tier title
  - unlock condition text
  - unlocked/locked state
- Locked cards:
  - grayscale + reduced opacity
- Unlocked cards:
  - colored icon accent
- Profile header shows summary:
  - unlocked count / total count

## Current Icon Mapping (built-in symbol font)
Because Dicefiles already ships a custom icon font (`i-*` classes), this implementation maps achievements to existing icon classes.

Examples:
- file progression: `i-file`, `i-upload`, `i-document`, `i-images`, `i-video`, `i-audio`, `i-archive`
- data volume progression: `i-upload-done`, `i-download`, `i-archive-b`, `i-file-b`, `i-document-b`, `i-clock`

## Future Image/Icon Upgrade Path
If we move from font icons to image badges:
- Place assets in `static/achievements/`.
- Add fields per achievement:
  - `imageUnlocked`
  - `imageLocked`
- Keep the same milestone IDs so existing unlock history remains stable.

Possible public-domain/openly-licensed icon sources to evaluate later:
- Heroicons (MIT)
- Tabler Icons (MIT)
- Lucide (ISC)

## Implementation Notes
- Server computes achievement state from existing upload stats (`files`, `uploaded bytes`).
- No migration required because stats already exist in Redis rankings.
- Rendering is deterministic and stateless per request.

## Data Contract Suggestion
Per achievement:
- `key`: stable id (`files-1000`, `bytes-1099511627776`)
- `kind`: `files` or `bytes`
- `icon`
- `title`
- `description`
- `required`
- `unlocked`

