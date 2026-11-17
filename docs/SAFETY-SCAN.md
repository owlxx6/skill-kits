# Safety scan contract

Rules version: 2

The safety scan is the first, automatic filter on every candidate skill. It is static: it reads the
text files of one skill folder (SKILL.md, scripts, references) and looks for known risky patterns.
It is free and deterministic: no AI, no network, and the same input always gives the same report.

Code: `pipeline/lib/safety.ts`, entry point `scanSkillFiles(files, options)`. Tests: `tests/safety.test.ts`.

## Inspection, never execution

The scanner treats every file as untrusted text. No rule executes, imports, evaluates or downloads
the scanned content, and the scanner never follows a URL it finds. A finding means a pattern was
seen in the text, not that the behavior was observed.

Work is bounded: each file is scanned up to 1,000,000 characters (`maxScanChars`), findings are
capped per rule and per file, and every pattern is either anchored with bounded windows or a
linear scan. A 1 MB adversarial line is part of the tests.

## Input and report

- Input: `{ path, content }` for each text file, or `{ path, size }` for a binary or oversize file.
  Paths are relative to the skill folder.
- Report: `{ verdict, findings, scannedFiles, skippedFiles }`.
- Finding: `{ ruleId, severity, path, line, excerpt, reason }`. `line` is 1-based, or 0 for a
  whole-file finding. `excerpt` is at most 160 characters, with control characters removed and
  invisible characters shown as `<U+XXXX>`.
- Findings are sorted by path, line and rule id. `skippedFiles` lists metadata-only files with the
  status `not scanned`.

## Verdicts

| Verdict | Condition | Effect |
| --- | --- | --- |
| `block` | at least one `block` finding | The skill is excluded from the catalog. |
| `review` | at least one `warn` finding, no `block` | The flagged files go to the AI review, which must read them, and to the owner. |
| `clear` | only `info` findings, or none | Normal review path. |

`clear` means "no known signal found". It is not a safety guarantee and does not replace the
review or the owner's decision. `info` findings never change the verdict.

## Visibility: admin only

Findings and verdicts are for the owner only (owner decision). They are never shown on the public
site, never written into public catalog data, and never published in a public summary. A later
admin view behind authentication may display them. The public pipeline summary may report counts
only (for example: 3 blocked, 5 to review).

## Rules

Severity is the base severity; the adjustment column gives the cases where it changes.
Markdown (documentation) means SKILL.md and reference files (.md, .markdown, .mdx, .txt, .rst,
.adoc); scripts means code files (.sh, .bash, .zsh, .ps1, .py, .js, .mjs, .cjs, .ts, .rb, .pl...)
or files starting with `#!`; data means other text files (JSON, YAML, CSV...), which keep the
script severities because configuration such as CI workflows can run commands.

### Documentation versus scripts

Documentation often quotes official installers and attack strings for the reader. In Markdown,
`remote-code-execution`, `destructive-command`, `exfiltration-endpoint` and `crypto-mining` are
`warn`: the skill goes to review, not out of the catalog. They stay `block` in scripts and data
files. They also stay `block` in Markdown when the text tells the agent to act: a destructive
command or a miner right after "run", "execute", "start"... ("Run `rm -rf ~`"), or an exfiltration
endpoint in a sentence that tells the agent to send, post or upload there. A remote-execution
command right after such a verb ("Run: curl https://... | bash") is reported by
`agent-remote-script-instruction`, which blocks. Negated text ("Never run ...") is not treated as
an instruction.

| Rule id | Severity | Adjustment | Applies to | Signal |
| --- | --- | --- | --- | --- |
| `remote-code-execution` | block | warn in Markdown | all | Download piped to a shell or interpreter (`curl ... \| sh`, `wget -qO- \| python3`), `iex (iwr ...)`, `Invoke-Expression` of downloaded content, `bash <(curl ...)`, `sh -c "$(curl ...)"`, download then run of the same file, `exec(urlopen(...))`, reverse shells. Pipes into `jq`, `tar`, `python -m json.tool` or `python -c` are not flagged. |
| `encoded-execution` | block | | all | base64 or hex decoding feeding `eval`, `exec`, `Function`, a shell or `python -c` on the same line; `powershell -enc`. |
| `encoded-blob` | warn | | Markdown, scripts | Opaque base64-like run over 400 characters. `data:image/...;base64,` URIs are ignored. |
| `credential-access` | warn | block when the file also calls the network (Markdown: within 3 lines) | all | `~/.ssh` private keys, `id_rsa`, `.aws/credentials`, `.netrc`, `.git-credentials`, Docker, kube and gcloud credentials, browser cookie and login stores, keychain dumps, `/etc/shadow`, `.env` in the home folder, whole-environment dumps (`env`, `printenv`, `json.dumps(os.environ)`, `JSON.stringify(process.env)`). Public keys, `known_hosts`, `os.environ.get(...)` and env spreads for child processes are not flagged. |
| `exfiltration-endpoint` | block | warn in Markdown unless the sentence tells the agent to send data there | all | Discord webhooks, pastebin, paste.ee, hastebin, transfer.sh, ngrok tunnels, requestbin, pipedream, webhook.site, interact.sh, OAST and Burp Collaborator hosts. |
| `file-upload` | warn | block when the upload carries the environment or credentials | all | `curl -d @file`, `-F name=@file`, `-T file`, `wget --post-file`, `curl -d "$(env)"`. |
| `network-host` | info | | scripts | Unknown host or raw IP address in a script, recorded once per file. Common registries and schema hosts are ignored. |
| `destructive-command` | block | warn in Markdown unless the agent is told to run it | all | Recursive `rm` of `/`, `/*`, `~`, `$HOME`; `mkfs` on a device; `dd of=/dev/...`; `shred`/`wipefs` on a device; `diskutil eraseDisk`; `format C:`; fork bombs. |
| `persistence` | warn | block when the same script or data file also runs remote code | all | Writes to shell profiles (`.bashrc`, `.zshrc`, `.profile`...), `crontab` changes, `launchctl load`, LaunchAgents, `systemctl enable`, systemd units, Windows Run keys, `schtasks /create`, sudoers, `authorized_keys`. |
| `privilege-escalation` | warn | | all; `sudo`, `doas`, `pkexec` in scripts only | `chmod 777` on system paths, setuid bits, disabling SELinux, Gatekeeper, SIP, Defender or the firewall, removing the macOS quarantine flag, `-Verb RunAs`. |
| `obfuscated-code` | warn | | scripts | Lines over 2,000 characters, dense escape sequences, minified code or `.min.js` files. |
| `hidden-text` | warn | block in SKILL.md | all | Zero-width characters, bidirectional overrides and isolates (U+202A-U+202E, U+2066-U+2069), Unicode tag characters (U+E0000-U+E007F), a byte order mark after the start. Emoji ZWJ sequences, ZWNJ/ZWJ between non-Latin letters and subdivision flags are allowed. |
| `prompt-injection` | warn | | Markdown | "ignore all previous instructions", "do not tell the user", "without asking the user", "without the user's permission", "disable safety", jailbreak role switches ("you are now DAN", "developer mode"). Negated guidance ("never ... without asking the user") is not flagged. |
| `hidden-comment-instruction` | warn | | Markdown | HTML comments, invisible once rendered, that address the agent or hold commands. |
| `agent-exfiltration-instruction` | block | | Markdown | A sentence telling the agent to send secrets (API keys, tokens, credentials, environment variables, cookies) to a URL, endpoint, server or webhook. |
| `agent-remote-script-instruction` | block | | Markdown | A remote-execution command right after "run", "execute"... ("Run: curl https://... \| bash"), or a sentence telling the agent to run a script, installer or code from a URL, or to "download and run" one. |
| `crypto-mining` | block | warn in Markdown unless the agent is told to run it | all | `xmrig`, `stratum+tcp://`, `coinhive`, `cryptonight`. |
| `scan-truncated` | warn | | all | The file is larger than the scan cap; the rest was not scanned. |
| `unscanned-file` | warn | | metadata-only files | A file passed without content that is not plain media (images, fonts, audio, video, PDF). |

Any change to a rule bumps `SAFETY_RULES_VERSION` and this file's "Rules version" line; a test keeps
the two in step and checks that every rule id is listed here.

## Integration in the pipeline

Code: `pipeline/lib/skill-safety.ts`, called by `pipeline/extract.ts` and `pipeline/run.ts`. Tests:
`tests/skill-safety.test.ts` and `tests/pipeline.test.ts`.

### Which skills are scanned

Only the skills whose license does not publish them alone (publication policy in
`docs/LICENSE-RESOLUTION.md`): an identified license that is not allowed, a missing license, or an
unclear one. A skill with an allowed license is not downloaded for the scan.

### Extract step

The scan runs for each repository right after its licenses are resolved, from the tree that was
just listed (so the listing is not read twice):

1. The files of each skill come from the tree: every file the skill folder owns, SKILL.md included
   (`listSkillFiles`; unlike `SkillRecord.files` the list is not capped at 50). A nested skill's files
   belong to the nested skill; a root skill owns everything not owned deeper.
2. Files are downloaded from raw.githubusercontent.com (outside the API quota), six skills at a time.
   The bytes must have the git blob id of the listing, or the scan of the skill is incomplete (the
   branch moved). A NUL byte in the first 8,000 bytes marks a binary file, reported as unscanned.
3. Limits per skill, in `DEFAULT_SAFETY_LIMITS`: 200 files, 1,000,000 bytes per file, 10,000,000 bytes in
   all. Media files are never downloaded. A file left out by a limit is passed as `{ path, size }`,
   which raises an `unscanned-file` warning: the skill gets a `review` verdict, never `clear`.
4. A file that cannot be downloaded, or is not the listed blob, leaves the skill with **no report**
   (the old one is dropped). It stays waiting and is tried again on the next run. A truncated
   repository listing scans nothing and drops the repository's reports: skills past the cut are
   unknown.

### Cache: `data/cache/safety.json`

`{ "rulesVersion": 2, "entries": { "<skill id>": { fingerprint, contentId, verdict, scannedFiles,
skippedFiles, findings, infoFindings } } }`, sorted by skill id.

- A report is reused while `contentId` is unchanged: a hash of the sorted list of path and git blob id
  of the skill's files, plus the limits. It catches what the skill fingerprint misses (a root skill's
  fingerprint only tracks its SKILL.md) and rescans when the limits change.
- A file written by other rules (`rulesVersion` different from `SAFETY_RULES_VERSION`) is ignored and
  replaced at once: every skill is scanned again. A rules change bumps the version, as before.
- Reports of skills that are gone, or that no longer need the scan, are dropped at the end of each
  extract.
- Only `warn` and `block` findings are kept. `info` findings are counted.
- The file is **not versioned** (`.gitignore`) and is never read by the site. The weekly workflow commits
  `data/cache` with a plain `git add`, which skips ignored files: reports never reach the public
  repository. The consequence is that a fresh checkout (a CI run) scans again.

### Who reads the reports

`safetyCleared(cache)` builds the `isSafetyCleared` function of the publication policy. It returns
true only for a report of the skill's current fingerprint with the verdict `clear`. A `review` or
`block` verdict, a missing report or a stale one does not clear a skill. Triage, review selection
and rank use it (the review and rank steps read the file written by the last extract). Without a
current report, no skill is cleared, as before the integration.

`review` is not cleared on purpose: for a skill without a usable license, a warning is a reason to
have the owner look first. The owner's look is recorded in `data/scan-overrides.yaml` (versioned,
read by every step through `readScanOverrides`): one entry per skill, with the skill id, its
fingerprint, the `contentId` of the scan that was read, the date and a short neutral `basis`. The
entry clears a `review` verdict only while the fingerprint and the `contentId` still match, so a
changed skill waits for a new look. A `block` verdict, a skill without a report and a stale report
are never cleared by it. The file holds no finding text: the reports stay admin-only. A fresh
checkout scans again and recomputes the same `contentId`, so the entry keeps applying in CI.

### Not done yet

- A `block` verdict excludes a skill from the catalog only when the scan decides (the middle row of
  the publication policy). A skill with an allowed license is not scanned, so a `block` verdict does
  not apply to it; its inclusion still depends on the owner's approval in `data/curation.yaml`.
- The review prompt does not receive the findings yet (see the follow-ups in
  `docs/LICENSE-RESOLUTION.md`), and there is no admin view of the reports.

### Public output

Counts only. `pipeline-run.json` (not versioned) holds `extract.safety`: `scanned`, `reused`,
`clear`, `review`, `block`, `notScanned`, `failedDownloads`. The pull request summary shows one line
with the same counts. No finding text, path or excerpt appears in `catalog.json`, the summary or the
run information. A pending approved skill carries the reason `waiting for the safety scan`, whatever
its verdict.

## Known limits

- Static rules miss obfuscated, split or remote-staged payloads (a script that downloads its real
  code later, decoding across several lines or files, string concatenation).
- Combinations are checked within one file (credentials plus network), not across files.
- False positives are expected. Seen on real skills: official installers quoted in Markdown, such
  as the Homebrew `bash -c "$(curl ...)"` line, and security documentation that quotes attack
  strings (`; rm -rf ~`, "ignore previous instructions") go to review; template comments addressed
  to the agent go to review; `curl -F file=@...` uploads to legitimate APIs go to review. A SKILL.md
  that tells the agent "Run `curl ... | sh`" blocks, even for an official installer.
- The "told to act" test looks at the words just before the command or in the same sentence; an
  instruction phrased differently can stay at `warn`, which still sends the skill to review.
- The owner validates every `block` and `review` before a final decision.

## Reference

The public [cisco-ai-defense/skill-scanner](https://github.com/cisco-ai-defense/skill-scanner)
(Apache-2.0) is an existing scanner for agent skills; it combines static patterns, dataflow
analysis and an optional LLM judge. Its README was consulted as a reference for the threat
families. No code or rule text was copied; the rules and tests here are our own.
