import type { z } from 'zod'

/** Parse a content file, or throw with the file and every failing field named. A tiny module of its own so content files can use it without importing schema.ts (and its config and places imports). */
export function parseOrThrow<T extends z.ZodType>(schema: T, data: unknown, source: string): z.output<T> {
  const result = schema.safeParse(data)
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    throw new Error(`${source} is invalid: ${details}`)
  }
  return result.data as z.output<T>
}
