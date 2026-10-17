/**
 * The fixed demo menu (L1): breakfast, lunch and dinner, six dishes each. meals.json is parsed with MealsSchema
 * at module load. No diet logic: the sim picks a dish per patient, and nothing here is clinical.
 */
import type { MealKind } from '@/sim/types'
import mealsJson from './meals.json'
import { type Dish, MealsSchema, parseOrThrow } from './schema'

export type { Dish } from './schema'

export const MEALS: Readonly<Record<MealKind, readonly Dish[]>> = parseOrThrow(MealsSchema, mealsJson, 'src/content/meals.json')

/** The six dishes of one meal, in menu order. */
export function dishesFor(meal: MealKind): readonly Dish[] {
  return MEALS[meal]
}
