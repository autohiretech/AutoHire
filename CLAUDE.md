# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**AutoHire** — (add a one-line description of what this project does).

## Repository

- GitHub: https://github.com/aluhubnotifications-ai/AutoHire (private)
- Default branch: `main`

## Getting started

- Dev: `npm run dev` (Vite, port 5173). Build: `npm run build` from `web/`.
- Edge functions are Deno: `deno check index.ts` / `deno test --allow-all` from
  the function's own directory.

## Deploying the web app

Cloudflare Pages, from the terminal — never from a git push:

```
wrangler pages deploy dist --project-name=autohiretech --branch=main
```

`--branch=main` is what makes it a **Production** deploy. Any other branch name
creates a preview at `<branch>.autohiretech.pages.dev` and leaves the live site
untouched.

**A build ships the working tree, not your commits.** When someone else has
uncommitted work in the repo, build from a detached worktree so only committed
code goes out:

```
git worktree add --detach /tmp/ah-deploy <commit>
cp web/.env /tmp/ah-deploy/web/.env      # REQUIRED — see below
```

**Always copy `web/.env` into the worktree.** It is gitignored, so a worktree
does not have it, and Vite inlines `VITE_*` at *build* time — a missing env var
fails silently at build and only explodes in the browser, with the whole app
rendering nothing. This took production down once already. `.env` also carries
`VITE_PAYMENTS_*`, so copy the file rather than passing vars inline.

Gate every deploy on this before uploading — it must print the URL:

```
grep -oh "https://[a-z0-9]*\.supabase\.co" dist/assets/*.js | head -1
```

Then **load the deployed page in a browser**. Checking that strings are present
in the bundle is not enough; only rendering the page catches a broken build.

Also delete `dist/__phone.html` before deploying — it is a dev-only harness in
`public/` that Vite copies into every build.

## Conventions

(Document code style, structure, and any project-specific conventions here.)
