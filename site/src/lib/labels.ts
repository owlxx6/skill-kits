// Client-safe labels, shared by server pages and the Browse script (no catalog import here).
export type SecurityLevel = "none" | "notice" | "severe";

/** Labels for the static scan level. Scan notes are private and never shown. */
export function securityLabel(level: SecurityLevel, short = false): string {
  if (short) return { none: "No flags", notice: "Notice", severe: "Severe" }[level];
  return { none: "No security flags", notice: "Security notice", severe: "Severe security flag" }[level];
}
