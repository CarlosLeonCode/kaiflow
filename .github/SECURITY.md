# Security Policy

## Supported versions

Only the latest release published on
[GitHub Releases](https://github.com/CarlosLeonCode/kaiflow/releases) receives
security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report it privately through GitHub Security Advisories:
[Report a vulnerability](https://github.com/CarlosLeonCode/kaiflow/security/advisories/new)
(repository tab **Security > Advisories > Report a vulnerability**).

Include, when possible:

- What is affected (app version, OS and version, component: tracking, storage, IPC, updater,
  AI review, landing page)
- Steps to reproduce or a proof of concept
- The impact you expect (data exposure, privilege escalation, code execution...)

You can expect an acknowledgement within 7 days. Once a fix is released, the advisory is
published and you are credited unless you prefer otherwise.

## Scope notes

Kaiflow is local-first. Things we consider security issues include, for example:

- Any path that sends tracked data off the device other than the opt-in AI weekly review
- Webview windows gaining access to commands or plugins they are not granted
  (`src-tauri/capabilities/`)
- Bypassing the updater signature check
- Leaking AI provider keys outside the OS keychain

Forks are maintained by their own owners; report issues in a fork to that fork.
