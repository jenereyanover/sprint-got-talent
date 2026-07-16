# Sprint's Got Talent — Retro Board

A "Got Talent" themed sprint retrospective board with two routes:

- `/` — **Performer view.** Team members sign in, add their acts, judge each other, and cast top-3 votes.
- `/host` — **Facilitator view.** The host runs the show: advances the acts, controls the shared act timer (1–30 min), and can reset the board for a new season. The host doesn't perform or vote.
- `/watch` — **Audience view.** A read-only spectator screen (great for a shared display or dial-in guests). It shows the live acts, finals, timer, and action items but has no sign-in and no controls — nothing can be changed from here.

Shared state lives in **Firebase Realtime Database** — the whole board is one JSON node per room. The browser subscribes with a realtime listener, so every device updates **instantly** (no polling), and writes go through atomic transactions so concurrent judges never clobber each other. There's no backend server to run; the static pages talk to Firebase directly.

## The flow

1. **Setup** — everyone signs in; the cast list fills up.
2. **Act 1 — Auditions** — performers add cards (hits / flops / new ideas).
3. **Act 2 — The Judging** — each performer judges every *other* performer's acts (⭐ / ❌) and has one 🔔 golden buzzer for the whole show.
4. **Act 3 — Semifinals** — after discussion, each performer casts up to three 🏆 votes. Golden-buzzed acts are locked into the finals.
5. **Act 4 — Results Show** — finalists become action items with owners.

## Firebase setup (one time)

1. Create a project at the [Firebase console](https://console.firebase.google.com/) (the free **Spark** plan is enough).
2. **Build → Realtime Database → Create Database.** Pick a region and start in **locked mode** — you'll paste rules below.
3. **Project settings → General → Your apps → Web app** (`</>`). Register an app; copy the `firebaseConfig` object.
4. Paste those values into [`public/firebase-config.js`](public/firebase-config.js), replacing the `YOUR_*` placeholders. Make sure `databaseURL` is set — that's the one Realtime Database needs.

Until real values are in place, the app runs in single-device demo mode (no sharing).

### Security rules

This board is honor-system with no login, so the rules just scope access to the `rooms` tree and cap the payload size. In **Realtime Database → Rules**, paste:

```json
{
  "rules": {
    "rooms": {
      "$room": {
        ".read": true,
        ".write": true,
        ".validate": "newData.isString() && newData.val().length < 300000"
      }
    }
  }
}
```

> Anyone with the link (and the `?room=` value) can read and write that board — same trust model as before. For anything sensitive, use an unguessable room value or add Firebase Auth and tighten the rules.

## Deploy

The app is fully static — host `public/` anywhere. Netlify config is already included:

### Option A — Netlify CLI (fastest)

```bash
npm install -g netlify-cli
cd sprints-got-talent
netlify login
netlify init      # create a new site (or link an existing one)
netlify deploy --prod
```

### Option B — Git

Push this folder to a GitHub/GitLab repo, then in Netlify: **Add new site → Import an existing project**. No build command needed; publish directory is `public` (already set in `netlify.toml`).

> Add your production domain under **Firebase console → Realtime Database → Rules** is not needed, but if you enable Firebase Auth later, add the domain under **Authentication → Settings → Authorized domains**.

## Using it

- Share `https://your-site.netlify.app` with the team.
- Keep `https://your-site.netlify.app/host` for yourself.
- Put `https://your-site.netlify.app/watch` on a shared screen (or send it to guests) for a read-only view.
- Test locally by serving `public/` over http (e.g. `npx serve public` or `netlify dev`) and opening two browsers — changes sync live through Firebase. Opening the HTML from `file://` won't load the ES modules; use a local server. Without valid Firebase config it falls back to single-device demo mode.

### Multiple boards

Append `?room=` to run parallel or archived boards, e.g.
`https://your-site.netlify.app?room=sprint42`, `https://your-site.netlify.app/host?room=sprint42`,
and `https://your-site.netlify.app/watch?room=sprint42`.
Everyone must use the same room value. Without it, you get the shared `default` room.

## Notes

- Identity is honor-system: a name typed at the gate. Fine for a team retro; don't use it for anything sensitive.
- The board is public to anyone with the URL. Use an unguessable `?room=` value (or Netlify's password protection on paid plans) if that matters.
- "New season" on the host view wipes the current room's board.
