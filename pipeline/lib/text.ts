// Plain code-unit order. localeCompare depends on the machine's locale, which would
// reorder the committed cache between a laptop and GitHub Actions.
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
