import { Pipe, PipeTransform } from '@angular/core';

/**
 * A count and its noun, singular or plural to match: "1 role", "3 roles" - never "3 role(s)".
 *
 * @example countOf(1, 'attempt')            // "1 attempt"
 * @example countOf(2, 'person', 'people')  // "2 people"
 */
export function countOf(count: number | null | undefined, singular: string, plural = `${singular}s`): string {
  const value = count ?? 0;
  return `${value} ${value === 1 ? singular : plural}`;
}

/** The verb form that agrees with a count: verbFor(1, 'is', 'are') is "is". */
export function verbFor(count: number | null | undefined, singular: string, plural: string): string {
  return (count ?? 0) === 1 ? singular : plural;
}

/**
 * {@link countOf} for templates.
 *
 * @example {{ mappedCount() | count: 'item' }}
 * @example {{ members | count: 'person' : 'people' }}
 */
@Pipe({ name: 'count', standalone: true })
export class CountPipe implements PipeTransform {
  transform(value: number | null | undefined, singular: string, plural?: string): string {
    return countOf(value, singular, plural);
  }
}
