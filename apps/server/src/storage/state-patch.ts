import type { State } from '@meteor-flow/contracts';

// The v1 repository never deletes rows. Arrays contain committed upserts, not
// replacement tables. A new writer always begins with a complete snapshot.
export type StatePatch = Partial<State>;
type Row = { id?: string; seq?: number };
export function applyStatePatch(state: State, patch: StatePatch): State {
  const next = { ...state };
  for (const table of Object.keys(patch) as Array<keyof State>) {
    if (table === 'settings') { next.settings = patch.settings!; continue; }
    const upserts = new Map((patch[table] as Row[]).map(row => [row.id ?? row.seq, row]));
    const rows = (state[table] as Row[]).map(row => {
      const id = row.id ?? row.seq;
      const replacement = upserts.get(id);
      upserts.delete(id);
      return replacement ?? row;
    });
    rows.push(...upserts.values());
    (next[table] as Row[]) = rows;
  }
  return next;
}
