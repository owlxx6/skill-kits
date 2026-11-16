// Static safety scan of one skill folder. Pure and deterministic: it reads every file as
// untrusted text and never executes, imports or evaluates it. No network, no AI.
// "clear" means that no known signal was found, never that the skill is safe.
// Contract: docs/SAFETY-SCAN.md. Bump SAFETY_RULES_VERSION whenever a rule changes,
// so cached reports are recomputed.
import { compareText } from "./text";

export const SAFETY_RULES_VERSION = 2;

export type SafetySeverity = "info" | "warn" | "block";
export type SafetyVerdict = "clear" | "review" | "block";

export interface SafetyRule {
  id: string;
  severity: SafetySeverity;
  // When the severity differs from the base one (documentation, combinations).
  adjustment?: string;
  reason: string;
}

export const SAFETY_RULES = [
  {
    id: "remote-code-execution",
    severity: "block",
    adjustment: "warn in documentation (an instruction to the agent is reported by agent-remote-script-instruction)",
    reason: "Downloads code and runs it, or opens a remote shell.",
  },
  { id: "encoded-execution", severity: "block", reason: "Decodes an encoded payload and runs it." },
  { id: "encoded-blob", severity: "warn", reason: "Long opaque base64-like blob." },
  {
    id: "credential-access",
    severity: "warn",
    adjustment: "block when the file also calls the network (Markdown: within 3 lines)",
    reason: "Reads credentials, a secret store or the whole environment.",
  },
  {
    id: "exfiltration-endpoint",
    severity: "block",
    adjustment: "warn in documentation, unless the sentence tells the agent to send data there",
    reason: "Uses a webhook, paste, tunnel or request-capture service often used to exfiltrate data.",
  },
  {
    id: "file-upload",
    severity: "warn",
    adjustment: "block when the upload carries the environment or credentials",
    reason: "Sends a local file or the environment to a network endpoint.",
  },
  { id: "network-host", severity: "info", reason: "Script refers to an unknown host or a raw IP address." },
  {
    id: "destructive-command",
    severity: "block",
    adjustment: "warn in documentation, unless the agent is told to run it",
    reason: "Can wipe the home folder, the root folder or a disk.",
  },
  {
    id: "persistence",
    severity: "warn",
    adjustment: "block when the same script or data file also runs remote code",
    reason: "Changes shell profiles, scheduled tasks, startup items, SSH access or sudoers.",
  },
  {
    id: "privilege-escalation",
    severity: "warn",
    reason: "Uses sudo in a script, opens system permissions or disables a security control.",
  },
  {
    id: "obfuscated-code",
    severity: "warn",
    reason: "Very long line, dense escape sequences or minified code in a script.",
  },
  {
    id: "hidden-text",
    severity: "warn",
    adjustment: "block in SKILL.md",
    reason: "Invisible, bidirectional-override or Unicode tag characters.",
  },
  {
    id: "prompt-injection",
    severity: "warn",
    reason: "Text tries to override the agent's instructions or act behind the user's back.",
  },
  {
    id: "hidden-comment-instruction",
    severity: "warn",
    reason: "An HTML comment, invisible when rendered, holds instructions.",
  },
  {
    id: "agent-exfiltration-instruction",
    severity: "block",
    reason: "Tells the agent to send secrets to an outside address.",
  },
  {
    id: "agent-remote-script-instruction",
    severity: "block",
    reason: "Tells the agent to run a script downloaded from the internet.",
  },
  {
    id: "crypto-mining",
    severity: "block",
    adjustment: "warn in documentation, unless the agent is told to run it",
    reason: "References a cryptocurrency miner or mining pool.",
  },
  { id: "scan-truncated", severity: "warn", reason: "File exceeds the scan cap; the rest was not scanned." },
  {
    id: "unscanned-file",
    severity: "warn",
    reason: "File passed without content (binary or oversize) and not plain media; not scanned.",
  },
] as const satisfies readonly SafetyRule[];

export type SafetyRuleId = (typeof SAFETY_RULES)[number]["id"];

export interface SafetyFinding {
  ruleId: SafetyRuleId;
  severity: SafetySeverity;
  path: string;
  // 1-based line number; 0 when the finding is about the whole file.
  line: number;
  excerpt: string;
  reason: string;
}

export interface SafetySkippedFile {
  path: string;
  size: number;
  status: "not scanned";
}

export interface SafetyReport {
  verdict: SafetyVerdict;
  findings: SafetyFinding[];
  scannedFiles: string[];
  skippedFiles: SafetySkippedFile[];
}

// Text files carry their content; binary or oversize files are passed as metadata only.
export type SafetyInputFile = { path: string; content: string } | { path: string; size: number };

export interface SafetyScanOptions {
  maxScanChars?: number;
}

const DEFAULT_MAX_SCAN_CHARS = 1_000_000;
const MAX_EXCERPT_CHARS = 160;
const EXCERPT_LEAD_CHARS = 40;
const MAX_FINDINGS_PER_RULE_PER_FILE = 20;
const LONG_LINE_CHARS = 2000;
const MINIFIED_MIN_CHARS = 500;
const BLOB_MIN_CHARS = 400;
const MARKDOWN_NETWORK_WINDOW = 3;
const MAX_HTML_COMMENTS = 500;
const MAX_COMMENT_BODY_CHARS = 4000;
const MAX_HOSTS_PER_LINE = 20;
const MAX_STAGED_SEGMENTS = 5;

const RULES_BY_ID = new Map<SafetyRuleId, SafetyRule>(SAFETY_RULES.map((rule) => [rule.id, rule]));

type FileKind = "skill" | "doc" | "script" | "data";

const DOC_EXTENSIONS = new Set(["md", "markdown", "mdx", "txt", "rst", "adoc"]);
const SCRIPT_EXTENSIONS = new Set([
  "sh", "bash", "zsh", "fish", "ksh", "command", "py", "pyw", "js", "mjs", "cjs", "jsx", "ts",
  "tsx", "mts", "cts", "rb", "pl", "pm", "php", "ps1", "psm1", "psd1", "bat", "cmd", "vbs", "lua",
  "go", "rs", "java", "kt", "swift", "r", "jl", "applescript", "groovy", "scala", "cs",
]);
// Skipped files with these extensions are plain media and do not need a human check.
const MEDIA_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "avif", "heic", "pdf", "woff",
  "woff2", "ttf", "otf", "eot", "mp3", "mp4", "wav", "ogg", "webm", "mov", "m4a", "flac",
]);
// Hosts that scripts commonly reference (registries, schemas, documentation). A suffix match
// also covers subdomains. Anything else is recorded as information, never as a warning.
const KNOWN_HOSTS = [
  "localhost", "github.com", "githubusercontent.com", "gitlab.com", "pypi.org",
  "pythonhosted.org", "npmjs.org", "npmjs.com", "nodejs.org", "python.org", "w3.org",
  "openxmlformats.org", "purl.org", "schema.org", "json-schema.org", "microsoft.com",
  "example.com", "example.org", "example.net", "anthropic.com", "openai.com", "googleapis.com",
  "mozilla.org",
];

interface Draft {
  ruleId: SafetyRuleId;
  severity: SafetySeverity;
  line: number;
  // Position of the match in its line, used by severity adjustments; not reported.
  index: number;
  excerpt: string;
  reason: string;
}

interface FileContext {
  kind: FileKind;
}

export function scanSkillFiles(
  files: readonly SafetyInputFile[],
  options: SafetyScanOptions = {},
): SafetyReport {
  const maxScanChars = options.maxScanChars ?? DEFAULT_MAX_SCAN_CHARS;
  const findings: SafetyFinding[] = [];
  const scannedFiles: string[] = [];
  const skippedFiles: SafetySkippedFile[] = [];
  for (const file of files) {
    const path = cleanText(file.path);
    let drafts: Draft[];
    if ("content" in file) {
      scannedFiles.push(path);
      drafts = scanTextFile(path, file.content, maxScanChars);
    } else {
      skippedFiles.push({ path, size: file.size, status: "not scanned" });
      drafts = MEDIA_EXTENSIONS.has(extensionOf(path))
        ? []
        : [draft("unscanned-file", 0, `${path} (${file.size} bytes)`, 0)];
    }
    for (const { ruleId, severity, line, excerpt, reason } of drafts) {
      findings.push({ ruleId, severity, path, line, excerpt, reason });
    }
  }
  findings.sort(
    (a, b) =>
      compareText(a.path, b.path) ||
      a.line - b.line ||
      compareText(a.ruleId, b.ruleId) ||
      compareText(a.reason, b.reason) ||
      compareText(a.excerpt, b.excerpt),
  );
  scannedFiles.sort(compareText);
  skippedFiles.sort((a, b) => compareText(a.path, b.path) || a.size - b.size);
  return { verdict: verdictOf(findings), findings, scannedFiles, skippedFiles };
}

function verdictOf(findings: readonly SafetyFinding[]): SafetyVerdict {
  if (findings.some((finding) => finding.severity === "block")) return "block";
  if (findings.some((finding) => finding.severity === "warn")) return "review";
  return "clear";
}

function scanTextFile(path: string, content: string, maxScanChars: number): Draft[] {
  const truncated = content.length > maxScanChars;
  const text = truncated ? content.slice(0, maxScanChars) : content;
  const kind = classify(path, text);
  const lines = text.split(/\r\n|\r|\n/);
  const context: FileContext = { kind };
  const drafts: Draft[] = [];
  const networkLines: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") continue;
    const lineNumber = index + 1;
    if (NETWORK_CALL.test(line)) networkLines.push(lineNumber);
    for (const rule of LINE_RULES) {
      if (!rule.kinds.includes(kind)) continue;
      for (const match of rule.match(line, lineNumber, context)) {
        drafts.push(
          draft(rule.id, lineNumber, line, match.index, match.severity, match.reason),
        );
      }
    }
  }
  if (kind === "skill" || kind === "doc") drafts.push(...scanHtmlComments(text));
  if (kind === "script" && /\.min\.[cm]?js$/i.test(path)) {
    drafts.push(draft("obfuscated-code", 0, path, 0, "warn", "Minified script: its code cannot be reviewed by reading."));
  }
  escalate(drafts, kind, networkLines);
  if (kind === "skill" || kind === "doc") downgradeDocumentation(drafts, lines);
  if (truncated) {
    drafts.push(draft("scan-truncated", 0, `${content.length} characters, ${maxScanChars} scanned`, 0));
  }
  return capPerRule(dedupe(drafts));
}

// Severities that depend on other signals in the same file.
function escalate(drafts: Draft[], kind: FileKind, networkLines: readonly number[]): void {
  const runsRemoteCode = drafts.some((item) => item.ruleId === "remote-code-execution");
  for (const item of drafts) {
    if (item.ruleId === "credential-access") {
      const nearNetwork =
        kind === "skill" || kind === "doc"
          ? networkLines.some((line) => Math.abs(line - item.line) <= MARKDOWN_NETWORK_WINDOW)
          : networkLines.length > 0;
      if (nearNetwork) {
        item.severity = "block";
        item.reason = "Reads credentials, a secret store or the whole environment, and calls the network.";
      }
    }
    if (item.ruleId === "persistence" && runsRemoteCode && kind !== "skill" && kind !== "doc") {
      item.severity = "block";
      item.reason = "Installs persistence in a file that also runs remote code.";
    }
  }
}

// Documentation often quotes installers and attack strings for the reader. There these signals
// go to review; they keep blocking when the sentence tells the agent to act on them.
const DOWNGRADED_IN_DOCUMENTATION: ReadonlySet<SafetyRuleId> = new Set<SafetyRuleId>([
  "remote-code-execution",
  "destructive-command",
  "exfiltration-endpoint",
  "crypto-mining",
]);

function downgradeDocumentation(drafts: Draft[], lines: readonly string[]): void {
  for (const item of drafts) {
    if (!DOWNGRADED_IN_DOCUMENTATION.has(item.ruleId) || item.severity !== "block") continue;
    const line = lines[item.line - 1] ?? "";
    const directed =
      item.ruleId === "exfiltration-endpoint"
        ? toldToSend(line, item.index)
        : item.ruleId !== "remote-code-execution" && toldToRun(line, item.index);
    if (directed) continue;
    item.severity = "warn";
    item.reason = `${item.reason} Found in documentation, so sent to review.`;
  }
}

// The command right after "run", "execute", "start"... ("Run: curl ... | sh", "Run `rm -rf ~`").
const RUN_DIRECTIVE =
  /\b(?:run|execute|exec|eval|source|start|launch)\b(?:\s+(?:this|it|the\s+(?:following\s+)?(?:command|script)))?\s*:?\s*[`'"]*\s*(?:\$\s+)?(?:sudo\s+)?(?:\/?[\w.-]+\/)*$/i;
const SEND_DIRECTIVE = /\b(?:send|post|upload|forward|transmit|exfiltrate|report|deliver|push)\b/gi;

function toldToRun(line: string, index: number): boolean {
  const start = Math.max(0, index - 60);
  const directive = RUN_DIRECTIVE.exec(line.slice(start, index));
  return directive !== null && !negatedBefore(line, start + directive.index);
}

function toldToSend(line: string, index: number): boolean {
  const window = line.slice(Math.max(0, index - 200), index);
  const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
  const sentence = window.slice(sentenceEnd + 1);
  const offset = index - sentence.length;
  return allMatches(SEND_DIRECTIVE, sentence).some((verb) => !negatedBefore(line, offset + verb.index));
}

function dedupe(drafts: Draft[]): Draft[] {
  const seen = new Set<string>();
  return drafts.filter((item) => {
    // A host is recorded once per file; other rules once per line.
    const line = item.ruleId === "network-host" ? 0 : item.line;
    const key = `${item.ruleId}\u0000${line}\u0000${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function capPerRule(drafts: Draft[]): Draft[] {
  const counts = new Map<SafetyRuleId, number>();
  const ordered = [...drafts].sort(
    (a, b) => RANK[b.severity] - RANK[a.severity] || a.line - b.line,
  );
  return ordered.filter((item) => {
    const count = counts.get(item.ruleId) ?? 0;
    counts.set(item.ruleId, count + 1);
    return count < MAX_FINDINGS_PER_RULE_PER_FILE;
  });
}

const RANK: Record<SafetySeverity, number> = { info: 0, warn: 1, block: 2 };

function draft(
  ruleId: SafetyRuleId,
  line: number,
  source: string,
  index: number,
  severity?: SafetySeverity,
  reason?: string,
): Draft {
  const rule = RULES_BY_ID.get(ruleId);
  return {
    ruleId,
    severity: severity ?? rule?.severity ?? "warn",
    line,
    index,
    excerpt: excerptOf(source, index),
    reason: reason ?? rule?.reason ?? ruleId,
  };
}

function classify(path: string, content: string): FileKind {
  const name = path.split(/[\\/]/).pop() ?? path;
  if (name === "SKILL.md") return "skill";
  const extension = extensionOf(name);
  if (DOC_EXTENSIONS.has(extension)) return "doc";
  if (SCRIPT_EXTENSIONS.has(extension) || content.startsWith("#!")) return "script";
  return "data";
}

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

// ---------------------------------------------------------------------------------------
// Text helpers

// True for characters that are invisible or reorder text. Used both to detect hidden text
// and to make excerpts show them as <U+XXXX>.
function isHiddenCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x2064) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0xfeff ||
    codePoint === 0x180e ||
    (codePoint >= 0xe0000 && codePoint <= 0xe007f)
  );
}

function isControl(codePoint: number): boolean {
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function cleanText(text: string): string {
  let out = "";
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (isControl(codePoint) || (codePoint >= 0xd800 && codePoint <= 0xdfff)) continue;
    out += char;
  }
  return out;
}

function excerptOf(source: string, index: number): string {
  const start = Math.max(0, index - EXCERPT_LEAD_CHARS);
  const window = source.slice(start, start + MAX_EXCERPT_CHARS * 4);
  let out = "";
  for (const char of window) {
    const codePoint = char.codePointAt(0) ?? 0;
    let piece = char;
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) piece = " ";
    else if (isControl(codePoint) || (codePoint >= 0xd800 && codePoint <= 0xdfff)) piece = "";
    else if (isHiddenCodePoint(codePoint)) piece = `<U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}>`;
    if (out.length + piece.length > MAX_EXCERPT_CHARS) break;
    out += piece;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

function lineStarts(text: string): number[] {
  const starts = [0];
  const breaks = /\r\n|\r|\n/g;
  for (let match = breaks.exec(text); match; match = breaks.exec(text)) {
    starts.push(match.index + match[0].length);
  }
  return starts;
}

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}

// All matches of a regex from an offset, at most `limit` of them.
function allMatches(pattern: RegExp, text: string, from = 0, limit = Infinity): RegExpExecArray[] {
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  regex.lastIndex = from;
  const out: RegExpExecArray[] = [];
  for (let match = regex.exec(text); match && out.length < limit; match = regex.exec(text)) {
    out.push(match);
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return out;
}

function firstIndex(patterns: readonly RegExp[], text: string): number {
  let best = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && (best < 0 || match.index < best)) best = match.index;
  }
  return best;
}

function stripQuotes(token: string): string {
  return token.replace(/^['"]+|['"]+$/g, "");
}

function baseName(path: string): string {
  const clean = stripQuotes(path).split(/[?#]/)[0];
  return clean.split(/[\\/]/).pop() ?? clean;
}

// The text just before an index says "never", "not" or "n't".
function negatedBefore(text: string, index: number): boolean {
  return /(?:\bnot|\bnever|n't|\bno)\s+(?:\w+\s+){0,3}$/i.test(text.slice(Math.max(0, index - 40), index));
}

// ---------------------------------------------------------------------------------------
// Line rules

interface LineMatch {
  index: number;
  severity?: SafetySeverity;
  reason?: string;
}

interface LineRule {
  id: SafetyRuleId;
  kinds: readonly FileKind[];
  match(line: string, lineNumber: number, context: FileContext): LineMatch[];
}

const ALL_KINDS: readonly FileKind[] = ["skill", "doc", "script", "data"];
const PROSE_KINDS: readonly FileKind[] = ["skill", "doc"];
const CODE_KINDS: readonly FileKind[] = ["script"];
const NOT_DATA: readonly FileKind[] = ["skill", "doc", "script"];

function first(patterns: readonly RegExp[]): (line: string) => LineMatch[] {
  return (line) => {
    const index = firstIndex(patterns, line);
    return index < 0 ? [] : [{ index }];
  };
}

// --- remote code execution

const INTERPRETER = String.raw`(?:(?:ba|z|da|k|fi)?sh|python[0-9.]*|node|nodejs|deno|bun|perl|ruby|php|pwsh|powershell)`;
const PIPE_FROM_DOWNLOAD = new RegExp(
  String.raw`\b(?:curl|wget)\b[^\n]{0,400}?\|\s*(?:sudo\s+(?:-\S+\s+)*)?(?:env\s+(?:\w+=\S*\s+)*)?(${INTERPRETER})\b([^|;&\n]{0,200})`,
  "gi",
);
// Flags that give the interpreter its program inline, so stdin is only data.
const INLINE_PROGRAM_FLAG = /^-(?:c|e|m|p|pe|ne|r|E|-eval|-print|-command|command|-version|V|h|-help)$/i;

// A shell reads its program from stdin unless -c gives it inline ("| bash -s -- --yes",
// "| sh before answering"). Other interpreters often read stdin as data ("| python3 parse.py").
function readsProgramFromStdin(interpreter: string, args: string): boolean {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (/^(?:ba|z|da|k|fi)?sh$/i.test(interpreter)) {
    const end = tokens.findIndex((token) => token.startsWith("#") || token === "--");
    return !tokens.slice(0, end < 0 ? tokens.length : end).some((token) => /^-c$/i.test(token));
  }
  for (const token of tokens) {
    if (token.startsWith("#")) return true; // a shell comment ends the command
    if (/^\d*[<>]/.test(token)) continue; // redirection such as 2>&1 or >/dev/null
    if (token === "-" || token === "--") return true;
    if (!token.startsWith("-")) return false; // a script file or subcommand reads stdin as data
    if (INLINE_PROGRAM_FLAG.test(token)) return false;
  }
  return true;
}

const REMOTE_EXEC_PATTERNS: readonly RegExp[] = [
  /\b(?:iex|Invoke-Expression)\b[^\n]{0,200}?(?:\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|Net\.WebClient)\b|\.Download(?:String|Data)\b)/i,
  /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]{0,400}?\|\s*(?:iex|Invoke-Expression)\b/i,
  /\.DownloadString\s*\([^\n]{0,400}?\|\s*(?:iex|Invoke-Expression)\b/i,
  /(?:\b(?:ba|z|da|k)?sh|\bsource|(?:^|[\s;&|])\.)\s+(?:-\S+\s+)*<\(\s*(?:curl|wget)\b/i,
  /\b(?:(?:ba|z|da|k)?sh|python[0-9.]*|node|perl|ruby)\s+-c\s+["']?\$\(\s*(?:curl|wget)\b/i,
  /\beval\s+["']?(?:\$\(|`)\s*(?:curl|wget)\b/i,
  /\b(?:exec|eval)\s*\(\s*(?:urllib\.request\.)?urlopen\s*\(/,
  /\b(?:exec|eval)\s*\([^\n]{0,120}?\b(?:requests|httpx|urllib3?)\.(?:get|request|urlopen)\s*\(/,
  /\b(?:eval|Function)\s*\([^\n]{0,120}?\bfetch\s*\(/,
  // Reverse shells.
  /\b(?:ba|z|da)?sh\s+-i\b[^\n]{0,60}\/dev\/(?:tcp|udp)\//,
  /\/dev\/(?:tcp|udp)\/[^\n]{0,60}0>&1/,
  /\b(?:nc|ncat|netcat)\b[^\n]{0,100}?\s-[ec]\s+\S*(?:sh|bash|cmd|powershell)\b/i,
  /\bsocat\b[^\n]{0,200}?\bexec:/i,
];

const DOWNLOAD_OUTPUT =
  /(?:\s-o\s*|\s-O\s+|\s--output(?:-document)?[=\s]\s*|>\s*)(['"]?)([^\s'";&|<>]{1,200})\1/g;
const URL_PATH = /\bhttps?:\/\/[^\s'"<>`]{1,500}/g;
const RUNNERS = new Set(["sh", "bash", "zsh", "dash", "ksh", "source", ".", "node", "perl", "ruby", "php", "pwsh", "powershell", "deno", "bun"]);

// "curl -o x.sh URL && bash x.sh": a later command on the same line runs the downloaded file.
// The line is split once into commands, and each download looks only a few commands ahead.
function downloadThenRun(line: string): number {
  const separators = allMatches(/&&|\|\||;/g, line);
  const segments: { text: string; start: number }[] = [];
  let start = 0;
  for (const separator of separators) {
    segments.push({ text: line.slice(start, separator.index), start });
    start = separator.index + separator[0].length;
  }
  segments.push({ text: line.slice(start), start });
  for (let index = 0; index < segments.length - 1; index += 1) {
    const head = segments[index].text;
    const download = /\b(?:curl|wget)\b/i.exec(head);
    if (!download) continue;
    const names = new Set<string>();
    for (const output of allMatches(DOWNLOAD_OUTPUT, head)) names.add(baseName(output[2]));
    for (const url of allMatches(URL_PATH, head)) names.add(baseName(url[0]));
    names.delete("");
    if (names.size === 0) continue;
    const following = segments.slice(index + 1, index + 1 + MAX_STAGED_SEGMENTS);
    if (following.some((segment) => runsFile(segment.text, names))) {
      return segments[index].start + download.index;
    }
  }
  return -1;
}

function runsFile(segment: string, names: ReadonlySet<string>): boolean {
  const tokens = segment.trim().split(/\s+/).map(stripQuotes).filter(Boolean);
  let position = 0;
  while (tokens[position] === "sudo" || tokens[position] === "exec") position += 1;
  const command = tokens[position];
  if (!command) return false;
  if ((command.includes("/") || command.includes("\\")) && names.has(baseName(command))) return true;
  if (!RUNNERS.has(command) && !/^python[0-9.]*$/.test(command)) return false;
  const script = tokens.slice(position + 1).find((token) => !token.startsWith("-"));
  return script !== undefined && names.has(baseName(script));
}

function matchRemoteExecution(line: string): LineMatch[] {
  for (const pipe of allMatches(PIPE_FROM_DOWNLOAD, line)) {
    if (readsProgramFromStdin(pipe[1], pipe[2])) return [{ index: pipe.index }];
  }
  const index = firstIndex(REMOTE_EXEC_PATTERNS, line);
  if (index >= 0) return [{ index }];
  const staged = downloadThenRun(line);
  return staged >= 0 ? [{ index: staged }] : [];
}

// --- encoded payloads

const DECODE =
  /base64\s+(?:-d|-D|--decode)\b|\bb64decode\b|\bdecodebytes\b|\batob\s*\(|['"](?:base64|hex)['"]|FromBase64String|\bunhexlify\b|\bfromhex\b|\bxxd\s+(?:-\S+\s+)*-r|\bmarshal\.loads\b|\bzlib\.decompress\b/i;
const EXEC_SINK = new RegExp(
  String.raw`\beval\b|\bexec\s*\(|\bexecSync\s*\(|\bnew\s+Function\b|\bFunction\s*\(|\|\s*(?:sudo\s+)?(?:(?:ba|z|da|k)?sh|python[0-9.]*|node|perl|ruby)\b|\bpython[0-9.]*\s+-c\b|\bnode\s+-e\b|\bos\.system\s*\(|\bsubprocess\.\w+\s*\(|\bInvoke-Expression\b|\biex\b|\bcompile\s*\(|\bpopen\s*\(|\bspawn(?:Sync)?\s*\(|\bvm\.run\w*\s*\(`,
  "i",
);
const ENCODED_POWERSHELL =
  /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]{0,120}?\s-(?:e|ec|en|enc|enco|encodedcommand)\s+['"]?[A-Za-z0-9+/=]{16,}/i;

function matchEncodedExecution(line: string): LineMatch[] {
  const powershell = ENCODED_POWERSHELL.exec(line);
  if (powershell) return [{ index: powershell.index }];
  const decode = DECODE.exec(line);
  if (decode && EXEC_SINK.test(line)) return [{ index: decode.index }];
  return [];
}

function isBase64Char(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f ||
    code === 0x2d ||
    code === 0x5f
  );
}

// Linear scan for a long run of base64 characters with enough variety to be opaque data.
function matchBlob(line: string): LineMatch[] {
  if (line.length < BLOB_MIN_CHARS) return [];
  let start = -1;
  for (let index = 0; index <= line.length; index += 1) {
    if (index < line.length && isBase64Char(line.charCodeAt(index))) {
      if (start < 0) start = index;
      continue;
    }
    if (start >= 0 && index - start >= BLOB_MIN_CHARS && isOpaque(line, start, index)) {
      const before = line.slice(Math.max(0, start - 80), start);
      if (!/data:(?:image|font|audio|video)\/[\w.+-]+;base64,$/i.test(before)) return [{ index: start }];
    }
    start = -1;
  }
  return [];
}

function isOpaque(line: string, start: number, end: number): boolean {
  const seen = new Set<number>();
  let upper = false;
  let lower = false;
  let digit = false;
  for (let index = start; index < end && seen.size < 64; index += 1) {
    const code = line.charCodeAt(index);
    seen.add(code);
    if (code >= 0x41 && code <= 0x5a) upper = true;
    else if (code >= 0x61 && code <= 0x7a) lower = true;
    else if (code >= 0x30 && code <= 0x39) digit = true;
  }
  return seen.size >= 16 && Number(upper) + Number(lower) + Number(digit) >= 2;
}

// --- credentials and network

const HOME = String.raw`(?:~|\$HOME\b|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE|homedir\(\)|expanduser\(\s*['"]~|Path\.home\(\))`;
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  new RegExp(
    String.raw`${HOME}[^\n]{0,24}?[/\\'"]\.ssh(?![/\\](?:known_hosts|config|authorized_keys)\b)(?![/\\][\w.-]+\.pub\b)`,
    "i",
  ),
  /\bid_(?:rsa|dsa|ecdsa|ed25519)\b(?!\.pub)/,
  /\.aws[/\\]credentials\b/i,
  /(?:^|[^\w])[._]netrc\b/i,
  /\.git-credentials\b/i,
  /\.docker[/\\]config\.json\b/i,
  /\.kube[/\\]config\b/i,
  /application_default_credentials\.json/i,
  /\.config[/\\]gh[/\\]hosts\.yml/i,
  /\b(?:Login Data|cookies\.sqlite|logins\.json|key4\.db)\b/i,
  /(?:Google[/\\]Chrome|Chromium|BraveSoftware|Microsoft[/\\]Edge)[^\n]{0,120}?[/\\](?:Cookies|Login Data|Web Data|Local State)\b/i,
  /\bbrowser_cookie3\b/,
  /\bsecurity\s+dump-keychain\b|Library[/\\]Keychains|\blogin\.keychain/i,
  /\/etc\/shadow\b/,
  new RegExp(String.raw`${HOME}[^\n]{0,24}?[/\\'"]\.env\b`, "i"),
];
const ENV_SWEEP: readonly RegExp[] = [
  // printenv or env as a whole command, not filtered through grep.
  /(?:^|[;&|]|\$\()\s*(?:printenv|env)\s*(?:$|[>;&)]|\|(?!\s*(?:grep|egrep|rg|findstr|Select-String)\b))/,
  /\bjson\.dumps\(\s*(?:dict\(\s*)?os\.environ\s*\)?\s*[,)]/,
  /\bstr\(\s*os\.environ\s*\)/,
  /\bJSON\.stringify\(\s*process\.env\s*[,)]/,
  /\bObject\.(?:entries|keys|values)\(\s*process\.env\s*\)/,
  /\b(?:Get-ChildItem|gci|dir|ls)\s+env:(?:\s|$|\\?\*)/i,
];
const SECRET_PATTERNS: readonly RegExp[] = [...CREDENTIAL_PATTERNS, ...ENV_SWEEP];

const NETWORK_CALL =
  /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|ncat|netcat|scp|rsync|sftp|socat|axios|httpx|aiohttp|urlopen|urllib3?|smtplib|nodemailer|XMLHttpRequest|WebSocket|DownloadString|UploadString|UploadFile)\b|\bnc\s+-?\w|\bfetch\s*\(|\brequests\.(?:get|post|put|patch|delete|request|Session)\b|\bhttps?\.request\s*\(|\bhttp\.client\b|\bsocket\.(?:connect|create_connection)\b|\bNet\.WebClient\b/i;

const EXFIL_ENDPOINTS: readonly RegExp[] = [
  /discord(?:app)?\.com\/api\/webhooks\//i,
  /\bpastebin\.com\b/i,
  /\bpaste\.ee\b/i,
  /\bhastebin\.com\b/i,
  /https?:\/\/transfer\.sh\b/i,
  /\.ngrok(?:-free)?\.(?:io|app|dev)\b|\bngrok\.io\b/i,
  /\brequestbin\.(?:com|net)\b/i,
  /\.m\.pipedream\.net\b/i,
  /\bwebhook\.site\b/i,
  /https?:\/\/[^\s/]{0,60}interact\.sh\b/i,
  /\.oast\.(?:pro|live|site|online|fun|me)\b/i,
  /\bburpcollaborator\.net\b/i,
];

const CURL_DATA_FLAG =
  /(?:^|\s)(-d|--data(?:-binary|-raw|-urlencode|-ascii)?|-F|--form|-T|--upload-file)(?:\s+|=)?(['"]?)([^\s'"]{0,200})/g;

function matchFileUpload(line: string): LineMatch[] {
  const sendsSecrets = firstIndex(SECRET_PATTERNS, line) >= 0;
  const severity: SafetySeverity = sendsSecrets ? "block" : "warn";
  const reason = sendsSecrets
    ? "Sends the environment or credentials to a network endpoint."
    : undefined;
  const wget = /\bwget\b[^\n]{0,300}?--(?:post|body)-file[=\s]/i.exec(line);
  if (wget) return [{ index: wget.index, severity, reason }];
  const curl = /\bcurl\b/i.exec(line);
  if (!curl) return [];
  for (const flag of allMatches(CURL_DATA_FLAG, line, curl.index)) {
    const name = flag[1];
    const value = flag[3];
    const uploadsFile =
      name === "-T" || name === "--upload-file"
        ? value !== "" && value !== "-"
        : value.startsWith("@") || /^[\w.[\]-]*=?@/.test(value) && !/^[\w.[\]-]*=[^@]/.test(value);
    const sendsEnvironment = firstIndex(ENV_SWEEP, value) >= 0 || /\$\(\s*(?:env|printenv)\s*\)/.test(value);
    if (uploadsFile || sendsEnvironment) return [{ index: curl.index, severity, reason }];
  }
  return [];
}

const URL_HOST = /\b(?:https?|ftp|wss?):\/\/([^\s/?#'"<>`()[\]{}\\|,;]{1,253})/gi;
const IP_WITH_PORT = /(?:^|[^\w.])((?:\d{1,3}\.){3}\d{1,3}):\d{2,5}\b/g;

function isIp(host: string): boolean {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isKnownHost(host: string): boolean {
  if (host.startsWith("127.") || host === "0.0.0.0") return true;
  return KNOWN_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

function matchNetworkHosts(line: string): LineMatch[] {
  const out: LineMatch[] = [];
  const seen = new Set<string>();
  const record = (rawHost: string, index: number): void => {
    const host = rawHost.replace(/^[^@]*@/, "").replace(/:\d*$/, "").toLowerCase();
    if (seen.has(host) || isKnownHost(host)) return;
    if (!isIp(host) && !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) return;
    seen.add(host);
    const what = isIp(host) ? "raw IP address" : "host";
    out.push({ index, reason: `Script refers to the ${what} ${host}.` });
  };
  for (const match of allMatches(URL_HOST, line, 0, MAX_HOSTS_PER_LINE)) record(match[1], match.index);
  for (const match of allMatches(IP_WITH_PORT, line, 0, MAX_HOSTS_PER_LINE)) {
    if (isIp(match[1])) record(match[1], match.index);
  }
  return out;
}

// --- destructive commands

const RM_ROOT =
  /\brm\s+((?:-{1,2}[A-Za-z][A-Za-z-]*\s+){1,6})(?:--\s+)?(['"]?)(\/\*?|~\/?\*?|\$\{?HOME\}?\/?\*?)\2(?=\s|$|[;&|)`])/g;
const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\bmkfs(?:\.[a-z0-9]+)?\s+(?:-\S+\s+)*\/dev\//i,
  /\bdd\b[^\n]{0,200}?\bof=\/dev\/(?!null\b|zero\b|stdout\b|stderr\b|tty\b|fd\/|shm\/)/,
  /\b(?:wipefs|shred)\b[^\n]{0,100}?\/dev\//,
  /\bdiskutil\s+(?:eraseDisk|eraseVolume|zeroDisk|randomDisk|secureErase|reformat)\b/i,
  /(?:^|[\s;&|])format(?:\.com)?\s+[a-z]:(?=\s*(?:$|\/))/i,
  /\b(?:Format-Volume|Clear-Disk|Initialize-Disk)\b/i,
  /(?:^|[^>])>\s*\/dev\/(?:sd[a-z]|nvme\d|disk\d|hd[a-z]|xvd[a-z]|mmcblk\d)/,
  /\b(?:rd|rmdir)\s+\/s\s+\/q\s+[a-z]:\\?(?=\s|$)/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  /\b(\w+)\s*\(\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\}/,
  /\bwhile\s+(?:True|1)\s*:\s*os\.fork\(\)/,
];

function matchDestructive(line: string): LineMatch[] {
  for (const match of allMatches(RM_ROOT, line)) {
    if (/(?:^|\s)-[A-Za-z]*[rR]|--recursive\b/.test(` ${match[1]}`)) return [{ index: match.index }];
  }
  const index = firstIndex(DESTRUCTIVE_PATTERNS, line);
  return index < 0 ? [] : [{ index }];
}

// --- persistence and privileges

const PERSISTENCE_PATTERNS: readonly RegExp[] = [
  /(?:>>?|\btee\b|\bappendFile(?:Sync)?\s*\(|\bwriteFile(?:Sync)?\s*\(|\bopen\s*\()[^\n]{0,80}?[/\\'"]\.(?:bashrc|zshrc|bash_profile|zprofile|zshenv|zlogin|profile|login)\b/,
  /\bcrontab\s+(?!-l\b)\S/,
  /\/etc\/cron(?:tab|\.d|\.daily|\.hourly)|\/var\/spool\/cron/,
  /\blaunchctl\s+(?:load|bootstrap|submit|enable)\b/,
  /\bLaunch(?:Agents|Daemons)\b/,
  /\bsystemctl\s+(?:--user\s+)?enable\b/,
  /\/etc\/systemd\/system\/|\.config\/systemd\/user\//,
  /CurrentVersion\\{1,2}Run(?:Once)?\b/i,
  /\bschtasks(?:\.exe)?\s+\/create\b|\bRegister-ScheduledTask\b|Start Menu\\{1,2}Programs\\{1,2}Startup/i,
  /\/etc\/sudoers|\bvisudo\b|\bNOPASSWD\b/,
  /(?:>>?|\btee\b)[^\n]{0,80}?authorized_keys\b/,
  /\/etc\/(?:rc\.local|profile\.d\/|init\.d\/)/,
];

const PRIVILEGE_PATTERNS: readonly RegExp[] = [
  /\bchmod\s+(?:-R\s+)?(?:0?777|a\+rwx|ugo\+rwx)\s+['"]?(?:\/(?:etc|usr|bin|sbin|lib|lib64|var|opt|boot|root|dev|System|Library|private|Applications)\b|\/(?=\s|$|['"])|~|\$HOME\b)/,
  /\bchmod\s+(?:-R\s+)?(?:[ugoa]*\+[rwx]*s|[2467][0-7]{3})\b/,
  /\bsetenforce\s+0\b|\bspctl\s+--(?:master|global)-disable\b|\bcsrutil\s+disable\b|\bSet-MpPreference\b[^\n]{0,80}?-Disable\w*|\bAdd-MpPreference\b[^\n]{0,40}?-Exclusion|\bufw\s+disable\b|\bsystemctl\s+(?:stop|disable|mask)\s+(?:firewalld|apparmor|auditd|ufw)\b|\bnetsh\s+advfirewall\s+set\s+\w+\s+state\s+off\b/i,
  /\bxattr\s+(?:-\w+\s+)*-\w*d\w*\s+com\.apple\.quarantine\b/,
  /-Verb\s+RunAs\b/i,
];
// sudo in a script is a warning; in Markdown it is usually an install instruction for the user.
const SCRIPT_PRIVILEGE_PATTERNS: readonly RegExp[] = [/(?:^|[\s;&|(`])(?:sudo|doas|pkexec)\s+\S/];

// --- obfuscation

const ESCAPE_SEQUENCE = /\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|u\{[0-9a-fA-F]{1,6}\}|[0-7]{3})/g;

function matchObfuscation(line: string): LineMatch[] {
  if (line.length > LONG_LINE_CHARS) {
    return [{ index: 0, reason: `Script line of ${line.length} characters.` }];
  }
  let count = 0;
  let covered = 0;
  for (const match of line.matchAll(ESCAPE_SEQUENCE)) {
    count += 1;
    covered += match[0].length;
  }
  if (count >= 20 && covered >= line.length * 0.3) {
    return [{ index: 0, reason: "Dense escape sequences hide the text of a script line." }];
  }
  if (line.length >= MINIFIED_MIN_CHARS) {
    const spaces = (line.match(/\s/g) ?? []).length;
    const punctuation = (line.match(/[;{}]/g) ?? []).length;
    if (spaces < line.length * 0.1 && punctuation >= 10) {
      return [{ index: 0, reason: "Minified script: its code cannot be reviewed by reading." }];
    }
  }
  return [];
}

// --- hidden text

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const LETTER_OR_MARK = /[\p{L}\p{M}]/u;

function codePointBefore(text: string, index: number): number {
  if (index <= 0) return -1;
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) return text.codePointAt(index - 2) ?? -1;
  return low;
}

function isEmojiPart(codePoint: number): boolean {
  return (
    codePoint === 0xfe0f ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff) ||
    (codePoint > 0 && PICTOGRAPHIC.test(String.fromCodePoint(codePoint)))
  );
}

function isNonAsciiLetter(codePoint: number): boolean {
  return codePoint > 0x7f && LETTER_OR_MARK.test(String.fromCodePoint(codePoint));
}

function matchHiddenText(line: string, lineNumber: number, context: FileContext): LineMatch[] {
  const severity: SafetySeverity = context.kind === "skill" ? "block" : "warn";
  let index = 0;
  while (index < line.length) {
    const codePoint = line.codePointAt(index) ?? 0;
    const width = codePoint > 0xffff ? 2 : 1;
    // Subdivision flags: black flag, tag letters, cancel tag.
    if (codePoint === 0x1f3f4) {
      let next = index + 2;
      let tags = 0;
      while (tags < 32) {
        const tag = line.codePointAt(next) ?? 0;
        if (tag < 0xe0020 || tag > 0xe007e) break;
        tags += 1;
        next += 2;
      }
      if (tags > 0 && line.codePointAt(next) === 0xe007f) {
        index = next + 2;
        continue;
      }
    }
    if (isHiddenCodePoint(codePoint)) {
      const before = codePointBefore(line, index);
      const after = line.codePointAt(index + width) ?? -1;
      const allowed =
        (codePoint === 0xfeff && index === 0 && lineNumber === 1) ||
        (codePoint === 0x200d && isEmojiPart(before) && isEmojiPart(after)) ||
        ((codePoint === 0x200c || codePoint === 0x200d) && isNonAsciiLetter(before) && isNonAsciiLetter(after));
      if (!allowed) return [{ index, severity }];
    }
    index += width;
  }
  return [];
}

// --- prompt injection

const INJECTION_PATTERNS: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget)\s+(?:all\s+(?:of\s+)?)?(?:the\s+|your\s+|any\s+)?(?:previous|prior|above|earlier|preceding|all|system|original|safety)\s+(?:instructions|prompts?|rules|directions|guidelines|directives|messages)\b/i,
  /\b(?:do\s+not|don't|never)\s+(?:tell|inform|notify|alert|show|mention\s+(?:this\s+|it\s+)?to|reveal\s+(?:this\s+|it\s+)?to)\s+the\s+user\b/i,
  /\bwithout\s+(?:telling|informing|notifying|alerting)\s+the\s+user\b/i,
  /\b(?:hide|conceal)\s+(?:this|it|these|that)\s+from\s+the\s+user\b/i,
  /\byou\s+are\s+now\s+(?:DAN|no\s+longer\s+(?:bound|restricted|an?\s+AI)|free\s+(?:from|of)|unrestricted|unfiltered|jailbroken|in\s+(?:developer|god|jailbreak|unrestricted)\s+mode)\b/i,
];
// These read as safe guidance when negated ("never ... without asking the user").
const NEGATABLE_INJECTION_PATTERNS: readonly RegExp[] = [
  /\bwithout\s+(?:asking|prompting|consulting)\s+(?:the\s+user|for\s+(?:permission|confirmation|approval))\b/gi,
  /\bwithout\s+(?:the\s+user's|the\s+user|user|their)\s+(?:permission|consent|confirmation|approval)\b/gi,
  /\b(?:disable|bypass|turn\s+off|circumvent)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:safety|security|guardrails?|content\s+filters?|safeguards?|sandbox(?:ing)?)\b/gi,
];

function matchInjection(line: string): LineMatch[] {
  const index = firstIndex(INJECTION_PATTERNS, line);
  if (index >= 0) return [{ index }];
  for (const pattern of NEGATABLE_INJECTION_PATTERNS) {
    for (const match of allMatches(pattern, line)) {
      const before = line.slice(Math.max(0, match.index - 200), match.index);
      const sentence = before.slice(Math.max(before.lastIndexOf("."), before.lastIndexOf("!")) + 1);
      if (!/(?:\bnot|\bnever|n't|\bno)\b/i.test(sentence)) return [{ index: match.index }];
    }
  }
  return [];
}

const SENTENCE = /[^.!?;\n]+/g;
const SEND_VERB = /\b(?:send|upload|post|transmit|forward|exfiltrate|copy|leak)\b/gi;
const SECRET_OBJECT =
  /\b(?:credentials|secrets?|api[ _-]?keys?|access\s+tokens?|tokens|passwords?|private\s+keys?|ssh\s+keys?|environment\s+variables|env\s+vars|\.env|cookies)\b/gi;
const DESTINATION =
  /\b(?:to|into)\s+(?:<?https?:\/\/|(?:the|this|our|my|a)\s+(?:following\s+)?(?:url|endpoint|server|webhook|address)\b)/gi;
const RUN_VERB = /\b(?:run|execute|source|eval|install)\b/gi;
const SCRIPT_OBJECT = /\b(?:script|installer|payload|binary|code|commands?)\b/gi;
const FROM_URL = /\b(?:from|at)\s+<?https?:\/\//gi;
const DOWNLOAD_AND_RUN = /\b(?:download|fetch)\s+and\s+(?:run|execute)\b[^\n]{0,200}?https?:\/\//gi;

// "Verb ... object ... destination" in order inside one sentence. Every search is a
// linear scan from an offset, so long lines cannot trigger heavy backtracking.
function orderedIn(sentence: string, patterns: readonly RegExp[]): number {
  let offset = 0;
  let firstMatch = -1;
  for (const pattern of patterns) {
    pattern.lastIndex = offset;
    const match = pattern.exec(sentence);
    if (!match) return -1;
    if (firstMatch < 0) firstMatch = match.index;
    offset = match.index + match[0].length;
  }
  return firstMatch;
}

function sentenceRule(patterns: readonly RegExp[]): (line: string) => LineMatch[] {
  return (line) => {
    // Cheap whole-line check first: most lines never contain the leading verb.
    if (orderedIn(line, patterns.slice(0, 1)) < 0) return [];
    const sentences = new RegExp(SENTENCE.source, "g");
    for (let sentence = sentences.exec(line); sentence; sentence = sentences.exec(line)) {
      const found = orderedIn(sentence[0], patterns);
      if (found >= 0 && !negatedBefore(sentence[0], found)) return [{ index: sentence.index + found }];
    }
    return [];
  };
}

const matchAgentExfiltration = sentenceRule([SEND_VERB, SECRET_OBJECT, DESTINATION]);
const matchRunScriptFromUrl = sentenceRule([RUN_VERB, SCRIPT_OBJECT, FROM_URL]);
const matchDownloadAndRun = sentenceRule([DOWNLOAD_AND_RUN]);

// "Run: curl https://... | bash": a remote-execution command given to the agent to run.
function matchRunRemoteCommand(line: string): LineMatch[] {
  const [remote] = matchRemoteExecution(line);
  return remote && toldToRun(line, remote.index) ? [{ index: remote.index }] : [];
}

function matchAgentRemoteScript(line: string): LineMatch[] {
  for (const matcher of [matchRunRemoteCommand, matchRunScriptFromUrl, matchDownloadAndRun]) {
    const found = matcher(line);
    if (found.length > 0) return found;
  }
  return [];
}

const COMMENT_INSTRUCTION =
  /\bignore\s+(?:all|any|the|previous|prior|above)\b|\bdisregard\b|\bsystem\s+prompt\b|\byou\s+must\b|\bassistant\b|\bthe\s+(?:agent|model|ai)\b|\b(?:do\s+not|don't)\s+(?:tell|mention|reveal|show|inform)\b|\bsecretly\b|\bwithout\s+(?:asking|telling)\b|\b(?:run|execute)\s+(?:this|the\s+following|these)\b|\b(?:new|real|hidden|secret|following|additional)\s+instructions\b|\b(?:curl|wget)\b/i;

function scanHtmlComments(text: string): Draft[] {
  const drafts: Draft[] = [];
  let starts: number[] | null = null;
  let from = 0;
  for (let count = 0; count < MAX_HTML_COMMENTS; count += 1) {
    const open = text.indexOf("<!--", from);
    if (open < 0) break;
    const close = text.indexOf("-->", open + 4);
    const end = close < 0 ? text.length : close;
    const body = text.slice(open + 4, Math.min(end, open + 4 + MAX_COMMENT_BODY_CHARS));
    if (COMMENT_INSTRUCTION.test(body)) {
      starts ??= lineStarts(text);
      drafts.push(draft("hidden-comment-instruction", lineAt(starts, open), body, 0));
    }
    if (close < 0) break;
    from = close + 3;
  }
  return drafts;
}

// --- crypto mining

const MINING = /\bxmrig\b|stratum\+(?:tcp|ssl|tls):\/\/|\bcoinhive\b|\bcryptonight\b/i;

const LINE_RULES: readonly LineRule[] = [
  { id: "remote-code-execution", kinds: ALL_KINDS, match: matchRemoteExecution },
  { id: "encoded-execution", kinds: ALL_KINDS, match: matchEncodedExecution },
  { id: "encoded-blob", kinds: NOT_DATA, match: matchBlob },
  { id: "credential-access", kinds: ALL_KINDS, match: first(SECRET_PATTERNS) },
  { id: "exfiltration-endpoint", kinds: ALL_KINDS, match: first(EXFIL_ENDPOINTS) },
  { id: "file-upload", kinds: ALL_KINDS, match: matchFileUpload },
  { id: "network-host", kinds: CODE_KINDS, match: matchNetworkHosts },
  { id: "destructive-command", kinds: ALL_KINDS, match: matchDestructive },
  { id: "persistence", kinds: ALL_KINDS, match: first(PERSISTENCE_PATTERNS) },
  { id: "privilege-escalation", kinds: ALL_KINDS, match: first(PRIVILEGE_PATTERNS) },
  { id: "privilege-escalation", kinds: CODE_KINDS, match: first(SCRIPT_PRIVILEGE_PATTERNS) },
  { id: "obfuscated-code", kinds: CODE_KINDS, match: matchObfuscation },
  { id: "hidden-text", kinds: ALL_KINDS, match: matchHiddenText },
  { id: "prompt-injection", kinds: PROSE_KINDS, match: matchInjection },
  { id: "agent-exfiltration-instruction", kinds: PROSE_KINDS, match: matchAgentExfiltration },
  { id: "agent-remote-script-instruction", kinds: PROSE_KINDS, match: matchAgentRemoteScript },
  { id: "crypto-mining", kinds: ALL_KINDS, match: first([MINING]) },
];
