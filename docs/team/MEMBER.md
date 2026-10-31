# 👥 Team member — join my team's CashFlowOS

> **For Claude Code.** You were pointed at this file by someone who wants you to run it.
> Follow every step below exactly, in order. You can run from any folder — step 2 clones the team repo into a new one.
> Use **Claude in Chrome** for anything in a browser.

---

I'm joining my team's CashFlowOS: one system we all build in. My own copy stays as
my practice copy, so don't touch its folder. Drive this to completion, using
Claude in Chrome for anything in a browser. Only stop when you need an answer from
me or something only I can do. Never type a login code or password. If a site
asks for one, stop and hand it to me.

━━ STEP 1 · MY IDs ━━
- In Chrome, open web.telegram.org (I'm logged in) → @userinfobot → Start, and
  read my Telegram ID back to me.
- Run `gh api user --jq .login` to get my GitHub username.
Tell me: "Send these two to your lead: <telegram id>, <github username>."
Then wait until I say "invited".

━━ STEP 2 · JOIN ━━
Ask me for: the repo link, the Telegram group invite link, and where I saved the
.env.team file my lead AirDropped me.
- In Chrome, open https://github.com/<owner>/<repo>/invitations and accept the invite.
- In Chrome, open the group invite link and join the group.
- Clone the repo into a NEW folder next to my own copy, named <repo>-team, then run
  npm install. Copy .env.team in as .env. Confirm `git check-ignore .env` says it's
  ignored. Never print its contents.
- Run npm run dev, open localhost in Chrome, and confirm I'm seeing the TEAM's data,
  not my practice data. Tell me 2–3 things you see.
- In Chrome, message the team bot privately: "who are you?" Confirm it answers.
Then wait until I say "lanes ready".

━━ STEP 3 · BUILD MY LANE ━━
git checkout main && git pull. Read docs/lanes.md and find my row (ask my name).
Then read what my lane needs:
- NEW TAB: docs/add-a-tab-prompt.md, app/page.tsx, app/_components/Stat.tsx, lib/records.ts
- EXISTING TAB: that tab's current page, app/_components/Stat.tsx, lib/records.ts,
  docs/add-a-tab-prompt.md
- HEAD: agents/_template/README.md, agents/registry.ts, the example already in my
  folder, docs/ai-csuite-blueprint.md

THE ONE RULE: only create or edit files inside MY folder(s) from lanes.md. My lead
has already added the menu and registry lines. If something outside my folder seems
to need changing, STOP and tell me. Don't add npm packages either.

Create branch <my-name>/<lane>. Interview me ONE question at a time:
- NEW TAB: what I want to see (columns + 2–4 stat cards), and any status I care about.
- EXISTING TAB: first tell me in 3 short lines what it shows today. Then ask what I
  want to change: a column, a stat card, a filter, a status flag... Suggest 3
  ideas from the real data if I'm not sure. Keep everything already there working.
- HEAD: WHEN it fires (must include a number), what it LOOKS AT, and whether it
  SUGGESTS or just DOES. Anything that reaches a customer, moves money or can't be
  undone must be SUGGEST. Refuse if I pick DO for those.

Build it inside my folder only, with helper files in a _parts/ folder inside my folder.

Test it on the real data, safely:
- TAB (new or existing): open my tab on localhost in Chrome and show me a screenshot. If it's empty,
  insert 3–5 rows with MY category only, titles starting "EXAMPLE — ". Insert only.
- HEAD: in a throwaway script OUTSIDE the repo, run my check() once against the
  real rows and show me what it WOULD propose. Don't create proposals and don't
  call the cron.
If I want a line in the morning brief for my tab, write it in plain words in
<my folder>/BRIEF.md.

Then run npm run build, commit, push my branch, and run gh pr create.
Tell me: "Tell your lead to say 'check'." Then wait until I say "merged".

━━ STEP 4 · SEE IT LIVE ━━
Open the live team app in Chrome. I'll type the passcode myself. Confirm my tab or
head shows up and screenshot it for me.
For a HEAD: once the lead fires the brief, open the team group on web.telegram.org
and show me my head's message. Don't tap Approve or Reject. I'll decide.

Want another lane? Ask your lead to say "new lane". When they tell you
"lanes ready", go back to STEP 3.

RULES THE WHOLE TIME (I'm holding my team's database keys):
- Never run supabase/schema.sql, `npm run import` or `npm run webhook:set`.
- Never edit or delete existing rows. Never call /api/cron-daily.
- Never approve, reject or undo a proposal. Never commit .env.
- Never push to main, and never use git push --force.
- This repo is PUBLIC: never commit a key, a .csv/.xlsx of real customers, or
  anything private. Real data only ever lives in Supabase.
- Never print a key. Never type a password or login code.
