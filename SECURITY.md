# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | yes       |

## Reporting a vulnerability

Email **security@nocturnalinc.com** (ticketed inbox, monitored) or open a private
vulnerability report via [GitHub's private reporting](https://github.com/bageera/lupine/security/advisories/new).

Please include: affected version/commit, reproduction steps, impact. We aim to
ack within 48h. Please do not open a public issue for a security problem.

## Scope notes

The wasm decoder (`crates/lupine`) parses untrusted bytes at a C ABI — memory
issues there are in scope. The JS glue trusts the demuxer's validation of
container formats; report format-confusion across that boundary too.