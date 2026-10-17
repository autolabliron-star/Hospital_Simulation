/** The interact prompt is one string in `useWalk.prompt`: "E · Prescribe for Grace Adeyemi". A locked one ("A4 has no patient right now") has no key. */

export interface PromptParts {
  /** The key cap ("E"), or null for a locked prompt. */
  key: string | null
  label: string
}

const KEYED = /^(\S{1,5}) · (.+)$/

export function splitPrompt(prompt: string): PromptParts {
  const m = KEYED.exec(prompt)
  return m ? { key: m[1], label: m[2] } : { key: null, label: prompt }
}
