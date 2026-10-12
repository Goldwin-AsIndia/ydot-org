import { MfaRequirement, UserDataScopeResponse } from './iam-contract.model';

/**
 * How the user screens word three facts about a person, so the directory, its record pane and
 * the full profile cannot disagree with one another.
 */

/**
 * True when a preferred name is set and says something the display name does not.
 *
 * "Priya Sharma" who goes by "Priya" is worth a second line; a preferred name typed identical to
 * the display name is not, and printing it twice reads as a mistake.
 */
export function showsPreferredName(person: { displayName?: string | null; preferredName?: string | null }): boolean {
  const preferred = (person.preferredName ?? '').trim();
  return preferred.length > 0 && preferred.toLowerCase() !== (person.displayName ?? '').trim().toLowerCase();
}

/**
 * The second-factor position in one line: whether it is required, where the requirement comes
 * from, and whether a factor is enrolled.
 *
 * "INHERITED" IS RESOLVED. It means "whatever the Organisation's default is"; the record carries
 * `isMfaEffectivelyRequired`, so this says "Required (organisation default)" rather than leaving
 * the reader to look the policy up.
 */
export function describeMfa(detail: {
  mfaEnabled?: boolean;
  mfaRequirement?: MfaRequirement;
  isMfaEffectivelyRequired?: boolean;
}): string {
  const required = detail.isMfaEffectivelyRequired === true || detail.mfaRequirement === 'required';
  const source = detail.mfaRequirement === 'inherited' ? ' (organisation default)' : '';
  const policy = `${required ? 'Required' : 'Optional'}${source}`;

  if (detail.mfaEnabled) {
    return `Enrolled · ${policy.charAt(0).toLowerCase()}${policy.slice(1)}`;
  }

  return required ? `${policy} · not yet enrolled` : `${policy} · not enrolled`;
}

/**
 * A person's data scopes in words.
 *
 * NO SCOPE IS THE WHOLE ORGANISATION, which is what the create form's "Organisation" choice
 * stores - it sends nothing to narrow. "Assignment" narrows every module to the person's own
 * records. The two value-less types are named by their type, never by their stored value, which
 * is an id nobody can read.
 */
export function describeDataScopes(scopes: readonly UserDataScopeResponse[] | null | undefined): string {
  const live = (scopes ?? []).filter((scope) => scope.isEffective !== false);

  if (live.length === 0) {
    return 'Whole organisation';
  }

  return live
    .map((scope) => {
      switch (scope.scopeType) {
        case 'organisation': return 'Whole organisation';
        case 'assignment': return 'Assigned records only';
        default: return scope.displayLabel || `${scope.scopeType ?? 'Scope'}: ${scope.scopeValue ?? ''}`;
      }
    })
    .filter((label, index, all) => all.indexOf(label) === index)
    .join(', ');
}
