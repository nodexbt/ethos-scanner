# Security policy

ethos-scanner handles reputation data about real people, so reports are taken seriously and answered quickly.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting on this repository ("Report a vulnerability" under the Security tab), or message [@nodexbt](https://x.com/nodexbt) on X for a private channel.

Include what you found, how to reproduce it, and what you think the impact is. You will get an acknowledgement within 72 hours and a fix or a decision within 14 days for anything that affects users' data or access.

## Scope

- The application at `ethos.tools` and this repository.
- Anything that lets someone read or change data they do not own, bypass the access rule, run scans without quota, or make the scanner produce a wrong result on purpose.

Out of scope: findings in the upstream services the app depends on (Ethos Network, Alchemy, X, Supabase, Vercel), which have their own programmes, and denial of service by sheer volume.

## How the app is defended

The design, the controls and the accepted risks are written up in [`docs/security.md`](docs/security.md).
