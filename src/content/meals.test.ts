import { describe, expect, it } from 'vitest'
import mealsJson from './meals.json'
import { MEALS, dishesFor } from './meals'
import { MEAL_KINDS, MealsSchema } from './schema'

describe('meals.json parses', () => {
  it('parses against MealsSchema', () => {
    expect(MealsSchema.safeParse(mealsJson).success).toBe(true)
  })

  it('has exactly breakfast, lunch and dinner', () => {
    expect([...MEAL_KINDS].sort()).toEqual(['breakfast', 'dinner', 'lunch'])
    expect(Object.keys(MEALS).sort()).toEqual(['breakfast', 'dinner', 'lunch'])
  })
})

describe('dishes', () => {
  it('every meal has exactly six dishes', () => {
    for (const meal of MEAL_KINDS) expect(MEALS[meal], meal).toHaveLength(6)
  })

  it('dish names are unique within each meal, and 1 to 3 words', () => {
    for (const meal of MEAL_KINDS) {
      const names = MEALS[meal].map((d) => d.name)
      expect(new Set(names).size, meal).toBe(names.length)
      for (const name of names) expect(name.trim().split(/\s+/).length, name).toBeLessThanOrEqual(3)
    }
  })

  it('every description is one line of plain text, up to 90 characters', () => {
    for (const meal of MEAL_KINDS) {
      for (const dish of MEALS[meal]) {
        expect(dish.description.length, dish.name).toBeGreaterThan(0)
        expect(dish.description.length, dish.name).toBeLessThanOrEqual(90)
        expect(dish.description, dish.name).not.toMatch(/[\r\n]/)
      }
    }
  })

  it('dishesFor returns the menu of that meal in order', () => {
    expect(dishesFor('lunch')).toEqual(MEALS.lunch)
    expect(dishesFor('dinner')[0].name).toBe(MEALS.dinner[0].name)
  })
})

describe('schema rejects bad menus', () => {
  it('rejects a meal with five dishes', () => {
    expect(MealsSchema.safeParse({ ...mealsJson, lunch: mealsJson.lunch.slice(1) }).success).toBe(false)
  })

  it('rejects a repeated dish name within a meal', () => {
    const repeated = mealsJson.dinner.map((d, i) => (i === 1 ? { ...d, name: mealsJson.dinner[0].name } : d))
    expect(MealsSchema.safeParse({ ...mealsJson, dinner: repeated }).success).toBe(false)
  })

  it('rejects a two-line description', () => {
    const broken = mealsJson.breakfast.map((d, i) => (i === 0 ? { ...d, description: 'Oats\nwith banana' } : d))
    expect(MealsSchema.safeParse({ ...mealsJson, breakfast: broken }).success).toBe(false)
  })
})
