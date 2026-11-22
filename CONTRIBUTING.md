# Contributing to JustMyClass

Thanks for contributing to JustMyClass.

## Local Setup

```bash
pnpm install
pnpm dev
```

## Checks Before Opening a PR

```bash
pnpm test
pnpm typecheck
```

- Never commit `.env` files, OAuth secrets, or API keys.
- Preserve local encrypted vault integrity guarantees (backup unreadable stores rather than deleting user data).
