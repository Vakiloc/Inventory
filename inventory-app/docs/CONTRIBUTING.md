# Contributing to Inventory

Thank you for your interest in contributing to the Household Inventory project! This document outlines the development workflow, testing requirements, and code review process.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Testing Requirements](#testing-requirements)
- [Pull Request Process](#pull-request-process)
- [Dependency Updates](#dependency-updates)
- [Release Process](#release-process)

## Getting Started

### Prerequisites

- **Node.js 20+** (for server and desktop development)
- **npm 8+** (comes with Node.js)
- **Java 17+** (for Android development)
- **Windows** (primary development platform; desktop builds require Windows)

### Initial Setup

From the `inventory-app/` directory:

```bash
# Install all workspace dependencies
npm install

# Run tests to verify setup
npm test

# Start development servers
npm run dev:all
```

For Android development, see [docs/ANDROID.md](./ANDROID.md).

## Development Workflow

### Branching Strategy

- **main**: Production-ready releases
- **develop-claude**: Active development branch
- **feature branches**: For new features or significant changes

### Making Changes

1. **Create a branch** from `develop-claude`:
   ```bash
   git checkout develop-claude
   git pull origin develop-claude
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the code standards below

3. **Test locally**:
   ```bash
   npm test                    # Run all tests
   npm test -w server          # Server tests only
   npm test -w desktop         # Desktop tests only
   npm run lint:i18n           # Validate translation keys
   ```

4. **Build to verify**:
   ```bash
   npm run build -w desktop    # Desktop build
   # For Android:
   cd android && ./gradlew :app:assembleDebug
   ```

5. **Commit with clear messages**:
   ```bash
   git add <files>
   git commit -m "Brief description of change"
   ```

6. **Push and create a PR**:
   ```bash
   git push origin feature/your-feature-name
   gh pr create --base develop-claude --fill
   ```

## Code Standards

### General Principles

- **ES modules everywhere**: Use `import`/`export`, not `require()` (except `preload.cjs`)
- **No framework in frontend**: Desktop renderer uses vanilla JavaScript, no React/Vue
- **Type validation**: Use Zod schemas for API payload validation
- **Direct DOM manipulation**: UI updates via `getElementById`, `innerHTML`, event listeners

### File Organization

- **Server code**: `server/src/` - Express routes, database access, business logic
- **Desktop code**: `desktop/src/` - Electron main process, renderer UI, IPC
- **Android code**: `android/app/src/main/java/` - Kotlin/Compose UI, Room, Retrofit

### Naming Conventions

- **Files**: kebab-case (`item-repository.js`, `scanner-ui.js`)
- **Functions**: camelCase (`getItems`, `validateInput`)
- **Classes**: PascalCase (`ItemRepository`, `WebAuthnService`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_PORT`, `MAX_RETRIES`)

### Database Migrations

- **Embedded migrations**: Use `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` in code
- **Inventory schema**: `inventory/db.js`
- **Identity schema**: `idp/stateDb.js`
- **No separate migration files**: Migrations run automatically on server start

### i18n (Internationalization)

- **Translation files**: `i18n/` directories in server and desktop workspaces
- **Key consistency**: All locales must have identical keys
- **Validation**: Run `npm run lint:i18n` before committing

## Testing Requirements

### What to Test

All pull requests must include tests for:

1. **New API endpoints**: Use Supertest in `server/test/`
2. **Business logic**: Unit tests for repositories, validation, etc.
3. **UI interactions**: Desktop tests with jsdom in `desktop/test/`
4. **Android features**: JUnit tests in `android/app/src/androidTest/`

### Test Standards

- **Isolation**: Tests must not depend on external state or network
- **Ephemeral databases**: Use `testDb.js` for server tests (creates temp SQLite files)
- **Mocking**: Mock Electron IPC, browser APIs, Android system services
- **Timeouts**: Server tests use 20-second timeout (configured in `vitest.config.js`)

### Running Tests

```bash
# All tests (required before PR)
npm test

# Watch mode during development
npm test -w server -- --watch
npm test -w desktop -- --watch

# Android unit tests
cd android && ./gradlew :app:testDebugUnitTest

# Android instrumented tests (requires emulator/device)
cd android && ./gradlew :app:connectedAndroidTest
```

### Test Coverage Expectations

- **Critical paths**: 100% coverage (auth, sync, data integrity)
- **API endpoints**: All endpoints must have at least one happy path test
- **Error handling**: Test validation errors, not-found cases, conflict scenarios

## Pull Request Process

### Before Submitting

- [ ] All tests pass (`npm test`)
- [ ] Code builds successfully (`npm run build -w desktop`)
- [ ] i18n keys are consistent (`npm run lint:i18n`)
- [ ] No unintended files in commit (`.sqlite*`, `node_modules/`, `dist/`)
- [ ] Commit messages are descriptive

### PR Description

Include in your PR description:

1. **What changed**: Brief summary of the feature/fix
2. **Why**: The problem being solved or feature being added
3. **Testing**: How you tested the changes
4. **Breaking changes**: Any backward-incompatible changes (rare)

### Code Review

- PRs require passing CI (GitHub Actions workflows)
- Maintainer will review within 2-3 business days
- Address feedback by pushing new commits to the same branch
- Once approved, maintainer will merge (usually squash merge)

### CI Requirements

All PRs must pass:

1. **Node tests (Windows)**: Server + Desktop tests
2. **Android unit tests (Linux)**: Gradle test suite

See [.github/workflows/ci.yml](../../.github/workflows/ci.yml) for workflow details.

## Dependency Updates

Dependency updates are managed by Dependabot. See [DEPENDABOT.md](./DEPENDABOT.md) for the update strategy and merge criteria.

**For contributors**:
- Prefer using existing dependencies over adding new ones
- Major dependency updates should be discussed in an issue first
- Update `package.json` / `build.gradle.kts` as needed, but don't manually bump versions that Dependabot manages

## Release Process

Releases are handled by maintainers. See [RELEASING.md](./RELEASING.md) for the full procedure.

**Version numbering**: SemVer (e.g., `0.1.4`)
- **Patch** (`0.1.x`): Bug fixes, minor improvements
- **Minor** (`0.x.0`): New features, non-breaking changes
- **Major** (`x.0.0`): Breaking changes (not yet used, still in 0.x phase)

## Questions?

- **Project documentation**: See [docs/](../docs/) directory
- **System design**: [docs/SYSTEM_DESIGN.md](../../docs/SYSTEM_DESIGN.md)
- **Security model**: [SECURITY.md](./SECURITY.md)
- **Android guide**: [ANDROID.md](./ANDROID.md)

Thank you for contributing!
