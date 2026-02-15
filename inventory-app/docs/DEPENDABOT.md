# Dependency Update Strategy

This document outlines how we manage automated dependency updates via Dependabot and the criteria for merging or deferring them.

## Table of Contents

- [Overview](#overview)
- [Dependabot Configuration](#dependabot-configuration)
- [Merge Criteria](#merge-criteria)
- [Update Categories](#update-categories)
- [Handling Conflicts](#handling-conflicts)
- [Blockers and Exceptions](#blockers-and-exceptions)

## Overview

Dependabot automatically opens pull requests for dependency updates on a weekly schedule. Our strategy balances staying current with stability and minimizing disruption.

**Goals:**
- Keep dependencies reasonably up-to-date for security and features
- Minimize CI overhead through grouped updates
- Avoid breaking changes that require significant refactoring
- Maintain a stable development experience

## Dependabot Configuration

Configuration file: [.github/dependabot.yml](../../.github/dependabot.yml)

### npm (Node.js packages)

- **Directory**: `/inventory-app` (workspace root)
- **Schedule**: Weekly (Mondays)
- **Grouping**: All npm dependencies grouped into a single PR (`npm-dependencies` group)

**Rationale**: Grouping reduces PR volume and allows testing all npm updates together for better compatibility validation.

### Gradle (Android packages)

- **Directory**: `/inventory-app/android`
- **Schedule**: Weekly (Mondays)
- **Grouping**: None (individual PRs per dependency)

**Rationale**: Android dependencies are more isolated. Individual PRs allow selective merging based on compatibility and migration requirements.

## Merge Criteria

### Automatic Approval (Green Light)

Merge immediately if ALL of the following are true:

- [ ] **CI passes**: Both Node and Android test workflows succeed
- [ ] **Patch/minor updates**: No major version jumps (e.g., `1.2.3` → `1.2.4` or `1.2.3` → `1.3.0`)
- [ ] **No breaking changes**: Release notes confirm backward compatibility
- [ ] **No new dependencies**: The update doesn't add transitive dependencies that conflict with our stack

### Review Required (Yellow Light)

Requires manual review and testing before merging:

- [ ] **Major version updates**: Version jumps like `2.x` → `3.x`
- [ ] **Deprecation warnings**: Update involves deprecated APIs we use
- [ ] **CI failures unrelated to the update**: Failures that appear environmental or pre-existing
- [ ] **Peer dependency conflicts**: npm/Gradle reports version conflicts

**Review Process:**
1. Read the release notes and changelog for breaking changes
2. Check if our code uses any deprecated/changed APIs
3. Test locally: `npm test`, `npm run build`, Android builds
4. If safe, merge with a note in the PR comment documenting any findings

### Defer/Close (Red Light)

Close or defer the PR if ANY of the following are true:

- [ ] **Requires major refactoring**: Update needs significant code changes (e.g., Express 4 → 5 API changes)
- [ ] **Breaks compatibility**: Incompatible with other dependencies (e.g., Room 2.8 requires Kotlin 2.0)
- [ ] **CI failures caused by the update**: Tests fail specifically due to the dependency change
- [ ] **Unstable release**: Pre-release versions, release candidates, or recently published versions with known issues
- [ ] **Outside support window**: We're not ready to adopt the new version (e.g., waiting for ecosystem to stabilize)

**Closure Process:**
1. Comment on the PR explaining why it's being closed
2. Use `@dependabot ignore this major version` if the blocker is long-term
3. Create a GitHub issue to track the deferred update if it's important

## Update Categories

### Critical (Merge ASAP)

- **Security patches**: CVE fixes, security advisories
- **Bug fixes**: Fixes for critical bugs affecting our use cases

**Timeline**: Within 1-2 days of PR creation

### Important (Merge Soon)

- **Dependency of dependency**: Transitive dependency updates that unlock other updates
- **End-of-life warnings**: Current version is deprecated or EOL
- **Performance improvements**: Significant performance gains documented

**Timeline**: Within 1 week of PR creation

### Nice-to-Have (Merge When Convenient)

- **New features**: Features we don't currently use
- **Minor improvements**: Small enhancements, refactors
- **Dev dependencies**: Testing tools, build tools (low risk)

**Timeline**: Within 2-4 weeks or next release cycle

### Deferred (Track for Future)

- **Breaking changes**: Require migration effort (e.g., major version bumps)
- **Platform upgrades**: Require toolchain updates (e.g., Kotlin 2.0, Node 22)
- **Experimental features**: Not yet stable or widely adopted

**Timeline**: Tracked in issues, planned for dedicated refactoring cycles

## Handling Conflicts

### Grouped npm PR Supersedes Individual PRs

When Dependabot opens a grouped `npm-dependencies` PR, it supersedes individual PRs for the same packages.

**Process:**
1. Review and merge the grouped PR first
2. Close individual PRs with a comment: "Superseded by grouped update in PR #X"
3. Confirm all superseded updates are included in the grouped PR

### Interdependent Android PRs

Some Android dependencies must be updated together (e.g., Retrofit + converter-gson).

**Process:**
1. Identify interdependent PRs by checking library ecosystems
2. Merge them in sequence: core library first, then plugins/converters
3. Alternatively, close both and create a manual combined PR

### Version Conflicts

If Dependabot opens a PR that conflicts with existing `package.json` or `build.gradle.kts` changes:

1. Use `@dependabot rebase` to rebase the PR on the latest branch
2. If conflicts persist, close the PR and manually update the dependency

## Blockers and Exceptions

### Known Blockers

| Dependency | Blocker | Resolution |
|------------|---------|------------|
| `androidx.room:room-runtime` 2.8+ | Requires Kotlin 2.0 migration | Deferred until Kotlin 2.0 migration is planned |
| `electron` (major bumps) | May require IPC API changes | Review release notes, test IPC thoroughly before merging |

### Permanent Exceptions

Some dependencies should NOT be auto-updated:

- **None currently**: All dependencies are eligible for Dependabot updates

### Ignoring Specific Updates

To ignore a specific version or major version permanently:

```bash
# Comment on the Dependabot PR:
@dependabot ignore this major version
@dependabot ignore this minor version
@dependabot ignore this dependency
```

This updates the Dependabot config automatically.

## Checklist for Merging Dependabot PRs

Before merging any Dependabot PR:

- [ ] Read the release notes / changelog for the updated package(s)
- [ ] Check CI status (both Node and Android workflows)
- [ ] Verify no breaking changes affect our codebase
- [ ] Test locally if it's a major update or affects core functionality
- [ ] Update this document if new blockers or patterns emerge
- [ ] Close superseded PRs if merging a grouped update

## Example Scenarios

### Scenario 1: Grouped npm Update (Green Light)

**PR**: Bump npm-dependencies with 12 updates (Express 4→5, Electron 30→40, etc.)

**Decision**: Merge if CI passes, but verify:
- Express 5 migration guide for breaking changes
- Electron 40 release notes for IPC changes
- Test desktop build: `npm run build -w desktop`

**Outcome**: Merged with note in commit message listing key updates

### Scenario 2: Room 2.6 → 2.8 (Red Light - Blocker)

**PR**: Bump androidx.room:room-runtime from 2.6.1 to 2.8.4

**Decision**: Close - requires Kotlin 2.0 migration

**Action**:
1. Comment explaining the Kotlin 2.0 requirement
2. Use `@dependabot ignore this major version`
3. Create issue: "Plan Kotlin 2.0 + Room 2.8 migration"

**Outcome**: Closed, tracked for future sprint

### Scenario 3: Retrofit 2.11 → 3.0 (Yellow Light)

**PR**: Bump Retrofit and converter-gson to 3.0

**Decision**: Review required

**Action**:
1. Check release notes: Retrofit 3.0 upgrades OkHttp 3→4 (Kotlin dependency added)
2. Verify our Retrofit code uses only stable APIs
3. Test Android build and sync functionality
4. Merge if compatible, otherwise defer

**Outcome**: Merged after successful testing

## Continuous Improvement

This document is a living guide. Update it when:

- New blockers are discovered
- Dependabot configuration changes
- Update patterns emerge (e.g., frequent failures in a package)
- Tooling changes (e.g., new CI requirements)

**Last updated**: 2026-02-15
