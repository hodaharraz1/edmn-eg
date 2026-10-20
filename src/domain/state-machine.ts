import { DomainError } from '@/server/core/errors';

/**
 * Explicit finite state machines. Every status column in the system is governed by one of these;
 * modules call `assert()` before writing a new status, so arbitrary transitions are impossible.
 */
export interface StateMachine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly terminal: readonly S[];
  can(from: S, to: S): boolean;
  assert(from: S, to: S): void;
  next(from: S): readonly S[];
}

export function defineMachine<S extends string>(
  name: string,
  states: readonly S[],
  transitions: { [K in S]?: readonly S[] },
): StateMachine<S> {
  const terminal = states.filter((s) => !transitions[s] || transitions[s]!.length === 0);
  return {
    name,
    states,
    terminal,
    can: (from, to) => (transitions[from] ?? []).includes(to),
    next: (from) => transitions[from] ?? [],
    assert(from, to) {
      if (!(transitions[from] ?? []).includes(to)) {
        throw new DomainError('INVALID_STATE', 'لا يمكن تنفيذ هذا الإجراء في الحالة الحالية', {
          machine: name,
          from,
          to,
        });
      }
    },
  };
}
