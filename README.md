# Sprint's Got Talent — Retro Board

A "Got Talent" themed sprint retrospective board with two routes:

- `/` — **Performer view.** Team members sign in, add their acts, judge each other, and cast top-3 votes.
- `/host` — **Facilitator view.** The host runs the show: advances the acts, controls the shared 60-second timer, and can reset the board for a new season. The host doesn't perform or vote.

Shared state lives in **Netlify Blobs** via one serverless function (`/api/state`), so everyone on the link sees the same live board (polled every ~3.5 seconds).

## The flow

1. **Setup** — everyone signs in; the cast list fills up.
2. **Act 1 — Auditions** — performers add cards (hits / flops / new ideas).
3. **Act 2 — The Judging** — each performer judges every *other* performer's acts (⭐ / ❌) and has one 🔔 golden buzzer for the whole show.
4. **Act 3 — Semifinals** — after discussion, each performer casts up to three 🏆 votes. Golden-buzzed acts are locked into the finals.
5. **Act 4 — Results Show** — finalists become action items with owners.

## Deploy to Netlify

### Option A — Netlify CLI (fastest)

```bash
npm install -g netlify-cli
cd sprints-got-talent
npm install
netlify login
netlify init      # create a new site (or link an existing one)
netlify deploy --prod
```

### Option B — Git

Push this folder to a GitHub/GitLab repo, then in Netlify: **Add new site → Import an existing project**. No build command needed; publish directory is `public` (already set in `netlify.toml`).

> Netlify Blobs and Functions are included on the free tier — no extra setup or environment variables required.

## Using it

- Share `https://your-site.netlify.app` with the team.
- Keep `https://your-site.netlify.app/host` for yourself.
- Test locally with `netlify dev` (this runs the function too; opening the HTML directly falls back to single-device demo mode).

### Multiple boards

Append `?room=` to run parallel or archived boards, e.g.
`https://your-site.netlify.app?room=sprint42` and `https://your-site.netlify.app/host?room=sprint42`.
Everyone must use the same room value. Without it, you get the shared `default` room.

## Notes

- Identity is honor-system: a name typed at the gate. Fine for a team retro; don't use it for anything sensitive.
- The board is public to anyone with the URL. Use an unguessable `?room=` value (or Netlify's password protection on paid plans) if that matters.
- "New season" on the host view wipes the current room's board.
