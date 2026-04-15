# stick-around


---

# Universal Rules

1. **Strict TypeScript** — No `any`, no `// @ts-ignore`, no `as unknown as`. Fix type errors, don't suppress them.
2. **Read before editing** — Understand existing code before modifying it.
3. **Match existing patterns** — Follow the conventions already established in each project.
4. **Test your changes** — Run typecheck and tests relevant to your changes.
5. **Git**: Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `ci:`). IMPORTANT: No Co-Authored-By trailer. No "Generated with Claude Code" footer in PR descriptions.

---

## Engineering Principles

### KISS

Prefer straightforward control flow. Keep error paths obvious and localized.

### YAGNI

Do not add interfaces, config keys, or abstractions without a concrete caller. No speculative features.

### DRY (Rule of Three)

Duplicate small local logic when it preserves clarity. Extract shared helpers only after three repeated, stable patterns.

### Secure by Default

Never log secrets or tokens. Validate at system boundaries. Keep network/filesystem/shell scope narrow.

### TDD

Write tests first. Red → Green → Refactor. New features and bug fixes start with a failing test that defines the expected behavior before writing implementation code.

---