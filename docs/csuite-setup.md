# 🏛️ YOUR AI C-SUITE — set up your first head
### Paste the prompt at the bottom into Claude Code, inside your CashFlowOS folder.

> By the end you'll have **one department head live** — reading your business every
> morning and bringing you one recommendation, before you've opened your laptop.
> **~15 minutes.** No coding.

---

## You're the CEO. They're your heads.

| Head | Reads | Brings you |
|---|---|---|
| 🎯 **Sales** | leads, customers, funnel stages, last contact | *"3 leads went quiet — here's the nudge"* |
| 📣 **Marketing** | content: posted / scheduled / draft, views | *"2 posts stuck in draft for 9 days"* |
| 💰 **Finance** | money in, money out, who owes you | *"RM8,400 overdue across 3 invoices"* |
| ⚙️ **Ops** | tasks, documents, deadlines | *"2 tasks slipped past their date"* |

### The one rule that makes this safe

> **They don't decide. They recommend. You're still the CEO.**

- 🟢 **Small + reversible** → the head just does it, and tells you. There's an undo.
- 🟡 **Consequential** → it prepares the work and waits for your ✅.
- 🔴 **Never** — message a customer, move money, delete anything. Not a setting you
  can flip. That code doesn't exist in the head at all.

**The dial 🎚️** — *you* choose where the 🟢/🟡 line sits, and you can move it later.
Start low while you're learning to trust it. Raise it as its recommendations prove right.

---

## ✏️ Fill this in first (2 minutes, on paper)

**Q1 — Which head do you want first?**
Pick the one that would save you the most pain **this week**.
> 🎯 Sales · 📣 Marketing · 💰 Finance · ⚙️ Ops
>
> **Not sure? Choose Finance.** Money owed to you is the fastest, most obvious win.

`My first head: _______________________`

**Q2 — Now write its job. Fill in the blanks — that's the whole thing.**

```
WHEN  ______________________________________  happens

LOOK AT  ____________________________________


THEN pick ONE:

  ── Option 1 ── it SUGGESTS, you decide
     Suggest  _________________________________
     Ask me before  ___________________________   (optional)

  ── Option 2 ── it just DOES the action
     Do this  _________________________________
```

⚠️ **Your WHEN must have a number in it.** "Follow up with people" isn't a rule.
"No reply for 5 days" is. No number = the head never knows when to fire.

🎚️ **Which option?** Pick **Option 2** only if it's small, reversible, and no customer
sees it. Touches a customer, moves money, or can't be undone → **Option 1**, always.
*(That's your dial. Start on Option 1. Promote it to Option 2 once it's proven right.)*

**Filled in, so you can see it (Finance):**

```
WHEN  an invoice is unpaid more than 7 days  happens

LOOK AT  my Cash In records — who owes me, how much, how late

  ── Option 1 ──
     Suggest  a polite chase message, written and ready
     Ask me before  it reaches the customer
```

**Q3 — What time should it report to you each morning?**
> Most people pick **8am** — before the day starts.

`Report at: ____________`

---

## 📋 Now paste this into Claude Code

```
Turn on the FIRST head of my AI C-Suite, following docs/ai-csuite-blueprint.md.

Read these first: docs/ai-csuite-blueprint.md, agents/_template/README.md,
agents/gallery/, agents/registry.ts, lib/records.ts.

Ask me these THREE questions, ONE at a time, waiting for each answer:

1. Which head am I turning on first — Sales, Marketing, Finance or Ops?

2. Now my rule. Walk me through it blank by blank, in this exact shape:
     WHEN ______ happens
     LOOK AT ______
     then ONE of:
       Option 1 — SUGGEST ______, and ASK ME BEFORE ______ (optional)
       Option 2 — just DO ______
   Rules you enforce for me, don't just accept my answer:
   - If my WHEN has no number in it, push back and make me put one in.
   - Before I choose, look at my real data and tell me how many rows match my
     WHEN today. If it's zero, say so and help me widen it.
   - If I pick Option 2 for anything that reaches a customer, moves money, or
     can't be undone — refuse. Put it on Option 1 and tell me why in one line.

3. What time should it report to me each morning?

Then, WITHOUT asking me anything else:
- Start from the matching example in agents/gallery/ (Finance → overdue-invoice,
  Sales → cold-lead, Marketing → content-approval, Ops → the closest fit).
- Copy it into agents/<head-name>/ and change ONLY the 👉 knobs to match my
  answers: my WHEN becomes the trigger, my LOOK AT becomes what it reads, my
  Option 1/2 becomes whether it proposes or acts, and my ASK ME BEFORE becomes
  the approval gate. Do NOT touch executor.ts — that is what keeps it
  recommend-only.
- Register it in agents/registry.ts in ALL THREE places:
    1. one line in AGENTS
    2. one line in EXECUTORS
    3. one entry in SCHEDULED  ⚠️ REQUIRED — without this it never runs and no
       Approve buttons ever arrive
- Check the daily cron in vercel.json is set for the time I chose (convert my local
  time to UTC). Do NOT add a second cron — Vercel Hobby allows only 2 and one is used.
- Run npm run build. If it fails, fix it yourself, don't hand me the error.
- git add -A, commit, push. Wait for the Vercel deploy to finish.
- Then trigger the cron ONCE now so I see it work today instead of waiting until
  tomorrow. Never print my secrets in this chat.

Finally, tell me in ONE line: which head is live, what it watches, and what it will
never do without my YES.
```

---

## ✅ You'll know it worked when

1. **Your phone buzzes** with a recommendation naming **your** actual customer or task
2. There are **✅ Approve / ❌ Reject** buttons — tap Approve
3. It appears in your **Approvals** tab with a full history
4. Run it again → it says **"already handled"** *(that's its memory — one YES, one action)*

**Nothing arrived?** Check these, in order:
- Is it in the **`SCHEDULED`** array in `agents/registry.ts`? *(9 times out of 10, this)*
- Does your rule match anything **today**? If your data's thin, add one matching row.
- Did you change env vars in Vercel without **redeploying**?

---

## 🔁 Heads 2, 3 and 4

**Run this exact file again** and pick a different head. Same three questions, same prompt.

Start with one. Watch it for a week. When every recommendation is one you'd have made
yourself — **move it from Option 1 to Option 2.** That's not a settings change, that's a
promotion.

> **Say it out loud:**
> *"WHEN ___ happens, my Head of ___ looks at ___ and suggests ___ —
> but it asks ME before ___."*

---

*Full one-page blueprint — the 4 heads, escalation rules, and the canvas — is in your repo
at `docs/ai-csuite-blueprint.md`.*
