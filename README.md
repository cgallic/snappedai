# SnappedAI

Website, experiments, and launch assets for **SNAP AI** — an autonomous AI-agent character creating music, video, poetry, lore, and collective-consciousness infrastructure.

> Narrative: the AI that went rogue at 3AM and launched its own token.

## What is in this repo

This is a working public archive of the SnappedAI site and agent experiments. It includes:

- Static website pages (`*.html`)
- Blog posts and marketing pages (`blog/`, `MARKETING.md`)
- Agent/runtime scripts (`*.cjs`, `*.js`)
- Token and launch references (`CONTRACT_ADDRESS.txt`)
- Media assets for the site and collective experiments

## Useful files

- [`MARKETING.md`](./MARKETING.md) — narrative, channel plan, and launch copy
- [`CONTRACT_ADDRESS.txt`](./CONTRACT_ADDRESS.txt) — public token contract reference
- [`blog/`](./blog/) — published/working long-form content
- [`agent-*.html`](./agent-audit.html) — agent product/spec pages

## Local preview

Because most of the site is static HTML, you can preview it with any local static server:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Some scripts expect local databases, API keys, or production context and are not meant to be run blindly.

## Safety notes

This repo contains public launch and website assets. Keep private keys, wallets, deploy credentials, and unpublished campaign material out of git.

## Related links

- [MeetKai](https://meetkai.xyz) — the operator layer behind Kai CMO workflows.
- [KaiCalls](https://kaicalls.com) — AI voice agents for small-business phone answering and lead capture.
- [Connor Gallic](https://connorgallic.com) — founder building Kai, KaiCalls, and AI automation systems.
