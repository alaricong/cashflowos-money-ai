# 👥 Build ONE CashFlowOS as a team

Everyone has already built their own CashFlowOS. Now the lead's copy becomes the team
system, and everyone builds in it together, in one sitting (~75–90 min).

**Open Claude Code with Claude in Chrome on. Log into web.telegram.org and github.com
in Chrome yourself first. Then paste ONE line:**

### 👑 Team lead — paste this inside your own CashFlowOS folder
```
Run: curl -sL https://raw.githubusercontent.com/claude-malaysia-glcc/cashflowos-ai-agents/main/docs/team/LEAD.md — then follow those instructions exactly, step by step.
```

### 👥 Team member — paste this anywhere
```
Run: curl -sL https://raw.githubusercontent.com/claude-malaysia-glcc/cashflowos-ai-agents/main/docs/team/MEMBER.md — then follow those instructions exactly, step by step.
```

Both start at the same time. They stay in sync with keywords you say out loud:

| Keyword | Who types it | When |
|---|---|---|
| **invited** | members | the lead's Claude says the team has been invited |
| **lanes ready** | members | the lead's Claude has claimed every lane |
| **check** | lead | someone has opened a pull request |
| **merged** | members | their pull request is merged |
| **done** | lead | to finish and fire the morning brief into the group |

### ⚠️ The lead's repo becomes PUBLIC
On Vercel's free Hobby plan, pushes by anyone other than the account owner to a
**private** repo are blocked from deploying. Teammates' work would never go live.
So the lead's prompt makes the repo public. **Only the code** becomes visible: the
keys stay in `.env` (never committed) and the data stays in Supabase.

Before it switches, it checks the repo's whole history for real data files and
anything that looks like a key. If it finds any, it **stops** and lets the lead
decide. Deleting a file doesn't remove it from history. Once public, it protects
`main` so nobody can force-push over a teammate's work.

Rather keep it private? That needs **Vercel Pro** (~USD 20/month) for team deploys.

**The rule that keeps it smooth:** the lead writes every shared line first, and members
only ever touch their own folder.
