# 👑 Team lead — make my CashFlowOS the team's

> **For Claude Code.** You were pointed at this file by someone who wants you to run it.
> Follow every step below exactly, in order. You must be running inside the lead's own CashFlowOS folder — if there is no `agents/registry.ts` here, stop and tell them to `cd` into it first.
> Use **Claude in Chrome** for anything in a browser.

---

You're setting up my TEAM's CashFlowOS — one system everyone builds in together,
in one sitting. My copy becomes the team's; everyone else's copy stays as their
practice copy. Drive this to completion. Use Claude in Chrome for anything in a
browser. Only stop when you need an answer from me or something only I can do.

━━ BEFORE ANYTHING ━━
Read .env.example, README.md, .gitignore, app/api/telegram/route.ts,
docs/add-a-tab-prompt.md, app/_components/Nav.tsx, app/_components/BottomNav.tsx,
app/cash-in/page.tsx, agents/registry.ts, agents/_template/ and agents/gallery/.
Run `vercel whoami` and `gh auth status`. If either fails, STOP and give me the
exact command to fix it.

━━ STEP 1 · WHO'S ON THE TEAM ━━
First tell me: "Ask each teammate to paste the MEMBER prompt now. It gives them
their Telegram ID and GitHub username to send you."
Then ask me ONE at a time, waiting for each answer:
1. My own Telegram user ID. If I'm logged into web.telegram.org, get it for me:
   open @userinfobot, press Start, and read it back.
2. A name for the team's Telegram group.
3. For each teammate, one at a time: their name, GitHub username, Telegram ID, and
   their lane, which is one of:
   - a NEW TAB: name + emoji + a fresh category string (NOT cash_in, cash_out,
     lead, customer, content, task or doc)
   - an EXISTING TAB to improve: any tab already in the menu (Leads, Cash In,
     Tasks, the Dashboard...). Nobody needs to have built a tab before.
   - a C-SUITE HEAD: Sales, Marketing, Finance or Ops
   One person per lane: no two people on the same tab or head. If a teammate
   doesn't know what they want, look at our data and suggest 3 lanes that fit,
   and let them pick. Keep asking until I say "done".

━━ STEP 2 · TELEGRAM (Chrome, web.telegram.org) ━━
I'm logged in already. Never type a login code or password. If Telegram asks for
one, stop and hand it to me. Don't message, leave or delete any chat except the
ones below.
- @BotFather → /setprivacy → ask me WHICH bot is my CashFlowOS bot (don't guess)
  → Disable. Confirm it now says disabled.
- Create a group with the name I gave you and add my bot. Then create an invite
  link and show it to me. I'll send it to the team.
- Get the group's chat ID: add @RawDataBot to the group (or @userinfobot if that
  fails), read the chat id from its message, then remove it. Show me the id.

━━ STEP 2b · MAKE THE REPO PUBLIC (required on free Vercel) ━━
Why: on Vercel's free Hobby plan, pushes by anyone except me to a PRIVATE repo are
blocked from deploying. Teammates' work would never go live. A public repo deploys
normally. Only the code becomes public: the keys stay in .env (never committed) and
the data stays in Supabase.
- Run `gh repo view --json visibility`. If it's already PUBLIC, skip to the
  ruleset below.
- If PRIVATE, check it's safe first. Show me file names and commit ids ONLY, never
  file contents:
  1. Every file ever committed that could hold real data:
     git log --all --name-only --pretty=format: | sort -u | grep -Ei '\.(csv|xlsx|xls|numbers|pdf|json|sql)$'
     (docs/sample-import.csv, supabase/schema.sql, package*.json and tsconfig.json
     come with the template and are fine.)
  2. Any commit that ever contained something key-shaped:
     git log --all --pretty=format:%h --name-only -G'(sk-ant-|service_role|SUPABASE_SERVICE_ROLE_KEY=.|TELEGRAM_BOT_TOKEN=.|eyJhbGciOi)'
     (.env.example is fine if it only has placeholders. Check it without printing values.)
- If anything else turns up: STOP. Don't make it public. Tell me which files and
  commits. Deleting a file now doesn't remove it from history, so the options are a
  fresh repo or Vercel Pro. Let me decide.
- If it's clean: tell me in one line that it's clean, then ask me "Make this repo
  public?" Wait for my yes, then run:
     gh repo edit --visibility public --accept-visibility-change-consequences
- Then protect main so nobody can wipe anyone's work. This is free on public repos:
     gh api -X POST repos/<owner>/<repo>/rulesets --input - <<'JSON'
     {"name":"protect main","target":"branch","enforcement":"active",
      "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
      "rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}
     JSON
  That blocks force-pushes and deleting main. It doesn't require pull requests,
  because I still commit the lane setup straight to main.

━━ STEP 3 · WIRE IT UP (terminal + Chrome) ━━
- In Vercel PRODUCTION, using the Vercel CLI (remove any old value first):
    TELEGRAM_ALLOWED_USER_IDS = every id, mine first, comma-separated, no spaces
    OWNER_CHAT_ID             = my id
    TELEGRAM_TEAM_CHAT_IDS    = the group id, minus sign kept
- APP_PASSCODE is a password, so you don't type it. In Chrome, open my Vercel
  project → Settings → Environment Variables → APP_PASSCODE, then let ME type the
  new passcode and save. Wait until I say "saved".
- Add each teammate as a GitHub collaborator:
    gh api -X PUT repos/<owner>/<repo>/collaborators/<username> -f permission=push
- Create .env.team containing ONLY the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
  lines from my .env. Use a command (e.g. grep into the file) so the values never
  appear in this chat. Prove git will never commit it: `git check-ignore .env.team`.
- Tell me: "Tell your team: invited."

━━ STEP 4 · CLAIM THE LANES (one commit, so nobody ever edits the same file) ━━
git checkout main && git pull. Then in ONE commit:
- For every TAB lane: create app/<tab>/page.tsx as a placeholder showing the
  existing empty-state box (follow the cash-in pattern), and add the tab to
  Nav.tsx (TABS) and BottomNav.tsx (MORE), one entry per line.
- For every HEAD lane: copy the closest agents/gallery example into
  agents/<lane>/. Add agents/<lane>/check.ts exporting a ScheduledCheck whose key
  matches the lane and whose check() returns [] for now, so it's registered but
  fires nothing yet. Register it in all three places in agents/registry.ts:
  AGENTS, EXECUTORS and SCHEDULED, importing from the lane folder. Rewrite
  SCHEDULED as a multi-line array with one entry per line, and keep
  overdueInvoiceCheck working.
- For every EXISTING TAB lane: create nothing. They own that tab's folder,
  e.g. app/leads/. The Dashboard is the single file app/page.tsx, NOT the whole
  app/ folder.
- Write docs/lanes.md: a table of name → folder(s) they own → category or agent key.
- npm run build must pass. Commit "team: claim lanes" and push to main.
- Wait for the Vercel deploy to finish. Then fetch https://<my-app>/api/telegram.
  It must say allowedUsers: <team size including me>. If it doesn't, fix it and
  check again.

━━ STEP 5 · HAND OVER ━━
Give me this checklist, then wait:
📤 AirDrop .env.team to each teammate. Never put it in the group chat.
🔗 Send them: the group invite link + the repo link <url>
🗣️ Say the passcode out loud
▶️ Tell the team: "lanes ready"
Then tell me: "Say 'check' whenever someone opens a pull request."

━━ STEP 6 · MERGE (every time I say "check") ━━
git checkout main && git pull, then gh pr list. For each open PR, one at a time:
1. gh pr diff <n> --name-only. Every file must be inside that person's folder(s)
   in lanes.md. If ANY file is outside, don't merge. Comment on the PR saying which
   file, tell me, and move on.
2. Check it out and run npm run build. If it fails, comment asking them to fix it
   and tell me in one line.
3. Give me a 2-line summary of what it adds and ask "merge?". Wait for my yes.
   Squash-merge and delete the branch. Then tell me: "Tell <name>: merged."
If any BRIEF.md files came in, add those lines to the morning brief in
app/api/cron-daily/route.ts using its existing pattern (never add a cron to
vercel.json). Show me the diff, then commit and push.

If I say "new lane" (someone finished and wants more, or changed their mind):
ask me who and which lane, then claim it exactly like STEP 4, in its own commit
on main. Push, and tell me: "Tell <name>: lanes ready."

━━ STEP 7 · FINISH (when I say "done") ━━
git checkout main && git pull, npm run build, and wait for the deploy.
Trigger the daily cron ONCE, reading CRON_SECRET from .env without printing it.
Then open the team group in Chrome and confirm the brief arrived there. That also
proves the group id is right. Don't tap Approve or Reject; the team does that.
Final report in 4 lines: team size · lanes merged · where the brief landed ·
anything still open.

RULES THE WHOLE TIME:
- Never print any key, the bot token, CRON_SECRET or the passcode. Never type a
  password or login code.
- Never commit .env or .env.team, or any real customer file. This repo is public.
  Never add a cron to vercel.json.
- Never use git push --force.
- Never approve, reject or undo a proposal.
