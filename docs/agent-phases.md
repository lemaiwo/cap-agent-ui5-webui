# Agent card: Phase A vs Phase B

This project defines the catalog agent two different ways over the course of the
branch, and captured the resulting agent card each time:

- [`agent-card-phase-a.json`](./agent-card-phase-a.json) — the `@agent` annotation alone
  ("auto-agentification"). `@cap-js/agents` derives the agent entirely from the CDS
  service definition: one auto-generated `query` skill for reading entities, and one
  auto-generated `submitOrder` skill per action.
- [`agent-card-phase-b.json`](./agent-card-phase-b.json) — the current state. The agent
  is defined explicitly by `srv/catalog-agent/AGENTS.md` plus
  `srv/catalog-agent/skills/book-purchase/SKILL.md`, which together replace the
  auto-generated skills with a single, hand-authored `book-purchase` skill.

## The observed difference

Under Phase A, `skills` lists two entries: `query` and `submitOrder`. Under Phase B,
`skills` lists exactly one: `book-purchase`. **`submitOrder` no longer appears as a
named skill in the agent card at all.**

Despite that, `submitOrder` remains fully callable — nothing about ordering a book
actually breaks. The reason is that `@cap-js/agents` builds the agent's *tools* and its
*card* from two independent sources: `buildTools()` derives the callable tool set
directly from the CDS service model (every action and queryable entity, regardless of
any markdown), while `generateAgentCard()` derives the `skills` array from the
markdown-defined skills when they exist, falling back to auto-generated entries only
when they don't. Defining `AGENTS.md`/`SKILL.md` changes what the card *advertises*, not
what the agent can *do*.

## Why this matters

The `skills` array is a discovery surface, not a binding gate. A consumer that decides
whether an action is available by scanning `skills` for an action name would conclude,
under Phase B, that this agent cannot place orders — `submitOrder` simply isn't there to
find. That conclusion would be wrong: asking the agent to order a book still works,
exactly as it did under Phase A, because tool availability is never gated by what the
card describes. Anyone building agent-discovery tooling against this plugin should treat
the card as a hint for humans and LLMs prompting the agent, not as a capability
manifest to enumerate programmatically.
