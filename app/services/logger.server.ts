export function logError(message: string, error?: unknown): void {
  if (error instanceof Error) {
    console.error(message, error.message);
  } else if (error !== undefined) {
    console.error(message, error);
  } else {
    console.error(message);
  }
}
