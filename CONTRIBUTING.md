# Contributing to Stick Around

Thanks for your interest in improving Stick Around, an overlay RPG that
runs on top of your terminal.

## Prerequisites

Stick Around is a Tauri app: a Rust core (`src-tauri/`) with a
TypeScript frontend (`src/`). You'll need Rust (cargo), Node, and your
platform's build toolchain. Install everything with:

    make deps

## Building and running

    make dev      # build the binary, install it, and link it into the
                  # plugin cache used by the /stick-around:play skill

Plain `npm run build` / `tauri build` does not copy the binary to the
launcher path, so relaunches would run a stale build. Always use
`make dev` after code changes.

## Tests and linting

This project follows TDD: start a new feature or bug fix with a failing
test that defines the expected behavior, then write the implementation.

    make test     # vitest run
    make lint     # eslint

Both must pass before you open a pull request.

## Code style

- Strict TypeScript. No `any`, no `// @ts-ignore`, no `as unknown as` —
  fix type errors rather than suppressing them.
- Read the surrounding code first and match the conventions already in
  each file.
- Prefer straightforward control flow; keep error paths obvious and
  localized.

## Commits and pull requests

- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`,
  `test:`, `ci:`, `docs:`.
- Keep each pull request scoped to one logical change with a clear
  description of what and why.

## Reporting bugs and requesting features

Open an issue with reproduction steps (for bugs) or a short description
of the use case (for features). For security issues, see
[SECURITY.md](SECURITY.md) — please don't file those as public issues.
