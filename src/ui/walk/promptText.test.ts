import { describe, expect, it } from 'vitest'
import { splitPrompt } from './promptText'

describe('splitPrompt', () => {
  it('splits the key cap from the words', () => {
    expect(splitPrompt('E · Prescribe for Grace Adeyemi')).toEqual({ key: 'E', label: 'Prescribe for Grace Adeyemi' })
    expect(splitPrompt('E · Stand up')).toEqual({ key: 'E', label: 'Stand up' })
  })

  it('shows a locked prompt as plain words with no key', () => {
    expect(splitPrompt('A4 has no patient right now')).toEqual({ key: null, label: 'A4 has no patient right now' })
  })

  it('does not mistake a long first word for a key', () => {
    expect(splitPrompt('Prescription · pending')).toEqual({ key: null, label: 'Prescription · pending' })
  })
})
