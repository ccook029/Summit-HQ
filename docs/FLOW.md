# How work actually flows

Every piece of work in HQ is a **work order**. It has exactly one status at
any moment, and that status says who is holding it. The board at `/work`
renders this whole document live.

## The path

```
  you assign            employee drafts        boss reviews
  ──────────►  queued  ──────────────►  in_progress  ──────────►  in_review
                                              ▲                      │
                                              │                      │
                              revision  ◄─────┴──────────────────────┤ revise
                            (redo with the boss's feedback,          │
                             up to 3 drafting rounds total)          │
                                                                     │
                      ┌──────────────────────────────────────────────┤
                      │ approve                          escalate    │
                      ▼                                              ▼
                  approved                                      escalated
          "waiting on you in /review"                "needs your answer first"
                      │
                      │ YOU approve in /review
                      ▼
                   shipped   ← the only point anything is written to Zoho Books
```

## The parts people get wrong

**A boss's "send back" is not a stop.** `revise` loops inside the same run:
the worker immediately redoes the draft with the boss's feedback and it goes
back to the same boss. Up to 3 drafting rounds; on the last round the boss
must approve or escalate, it can't send back again. So a single click on
"Create & run" may be four Claude calls before anything reaches you.

**A boss's approval ships nothing.** It moves the order to `approved`, which
means *waiting on Chris*. Your approval in `/review` is what runs the
department's ship executor — for Finance, that is the only code path that
records a customer payment in Zoho Books, and it re-verifies every invoice
against live Books data before posting.

**Reviews live on the worker's order.** Margot has no work orders of her own;
her rulings are attached to Otis's. Her page lists them under "Margot's
reviews".

**Positions with `reportsTo: null`** skip the boss entirely — their drafts go
straight to your queue.

## When something stalls

A run is one serverless request with a 300-second ceiling. A long finance
sweep can outlive it, and then the order sits in `in_progress` or `in_review`
with nobody driving it. `/work` flags anything live that hasn't moved in 12
minutes and gives you a Run button, which resets it to `queued` and re-runs.
Nothing is lost — completed rounds and reviews are already saved on the order.

## Where to look

| Question | Screen |
|---|---|
| Where is everything right now? | `/work` |
| What needs me? | `/review` |
| What did this employee do? | `/org/<employee>` |
| What did this boss sign off on? | `/org/<boss>` → reviews |
| What questions are open? | `/questions` |
