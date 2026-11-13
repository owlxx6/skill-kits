// Thrown when continuing the run cannot succeed (bad or missing API credentials).
export class FatalLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalLlmError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
