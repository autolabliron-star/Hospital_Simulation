/**
 * What a rostered post is called in the handover sentence ("took over {post} from ..."), one UK vocabulary (F-33). Parsed with zod at module
 * load; src/sim/day/roster.ts types the table by its `PostKind`, so a kind added there without words here fails the typecheck.
 */
import { z } from 'zod'
import postLabelsJson from './postLabels.json'
import { parseOrThrow } from './parse'

export const POST_KINDS = ['reception', 'triage', 'erDoctor', 'erNurse', 'porter', 'cleaner', 'imaging', 'command', 'wardNurse', 'wardDoctor'] as const
export type PostKindWord = (typeof POST_KINDS)[number]

const label = z.string().min(1).refine((s) => s === s.trim() && !/[\r\n]/.test(s), 'one line, no stray spaces')

export const PostLabelsSchema = z.strictObject(Object.fromEntries(POST_KINDS.map((k) => [k, label])) as Record<PostKindWord, typeof label>)

export const POST_LABEL_COPY: Readonly<Record<PostKindWord, string>> = parseOrThrow(PostLabelsSchema, postLabelsJson, 'src/content/postLabels.json')
