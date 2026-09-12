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

### The admin site is a second deploy

The admin area is **not** in the marketplace build. It is a second build of
the same source, deployed to its own Pages project:

```
npm run build:admin     # from web/ → dist-admin/
wrangler pages deploy dist-admin --project-name=autohiretech-admin --branch=main
```

Live at https://autohiretech-admin.pages.dev. `admin.html` →
`src/admin-main.tsx` is its entry; `public-admin/` replaces `public/` (no
service worker, no manifest, no `__phone.html`, plus frame-deny/noindex
headers). The same `.env` copy and Supabase-ref grep gate apply — grep
`dist-admin/assets/*.js`.

**A change to `src/pages/AdminPage.tsx` or anything it imports ships only
when the admin site is redeployed.** Deploying the marketplace alone leaves
the admin site on its old build. The marketplace itself must contain no
admin code — `App.tsx` forwards `/admin` to the admin origin — so a string
unique to `AdminPage.tsx` should appear in `dist-admin/` and never in `dist/`.

**Both projects share the data layer, so both need rebuilding.** A change to
`web/src/lib/supabaseClient.ts` or `packages/shared/src/index.ts` is in the
admin bundle as surely as the marketplace one, whoever it was written for.
"Not admin-facing" and "not in the admin bundle" are different things, and
this repo has separated them twice: an admin site left behind on an older
shared client looks fine until the day one of those methods changes shape.

Deploy to make an artifact match its sources, not to make two deployment
hashes match each other. If a rebuild emits the file the project is already
serving — compare the `assets/*.js` name, they are content-hashed — there is
nothing to ship and the deploy is pure churn.

**Leave `ALLOWED_ORIGIN` unset.** Every Edge Function answers
`Access-Control-Allow-Origin` with `Deno.env.get('ALLOWED_ORIGIN') ?? '*'`,
so the second origin already works. Setting it to either origin breaks the
other, a comma-list is an invalid header everywhere, and
`payhold-stripe-connect` and `payhold-create-deal` also build URLs from it.

## Conventions

(Document code style, structure, and any project-specific conventions here.)
