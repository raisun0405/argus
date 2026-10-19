// --- CHECKING DATA FROM OUTSIDE ---
// Small checkers for data that comes back from storage (a saved link) rather than from this page's own
// code: each returns the value when it has the expected shape, or FAIL. Objects keep only the fields
// their shape names, so nothing unexpected rides along.

export const FAIL = Symbol('fail');
export type Check<T> = (value: unknown) => T | typeof FAIL;

export const str = (max: number, pattern?: RegExp): Check<string> => v =>
  typeof v === 'string' && v.length <= max && (!pattern || pattern.test(v)) ? v : FAIL;

export const num = (min = -1e9, max = 1e9): Check<number> => v =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : FAIL;

export const int = (min = -1e9, max = 1e9): Check<number> => v => (Number.isInteger(v) ? num(min, max)(v) : FAIL);

export const bool: Check<boolean> = v => (typeof v === 'boolean' ? v : FAIL);

export const oneOf = <T extends string>(...values: T[]): Check<T> => v => (values.includes(v as T) ? (v as T) : FAIL);

export const nullable = <T>(check: Check<T>): Check<T | null> => v => (v === null ? null : check(v));

export const arr = <T>(check: Check<T>, max: number): Check<T[]> => v => {
  if (!Array.isArray(v) || v.length > max) return FAIL;
  const out: T[] = [];
  for (const item of v) {
    const checked = check(item);
    if (checked === FAIL) return FAIL;
    out.push(checked);
  }
  return out;
};

/** An object with these fields; a field whose key ends in "?" may be missing (or undefined). */
export const obj = <T>(fields: Record<string, Check<unknown>>): Check<T> => v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return FAIL;
  const out: Record<string, unknown> = {};
  for (const [spec, check] of Object.entries(fields)) {
    const optional = spec.endsWith('?');
    const key = optional ? spec.slice(0, -1) : spec;
    const value = (v as Record<string, unknown>)[key];
    if (value === undefined) {
      if (optional) continue;
      return FAIL;
    }
    const checked = check(value);
    if (checked === FAIL) return FAIL;
    out[key] = checked;
  }
  return out as T;
};

/** The first check that passes. */
export const either = <T>(...checks: Check<T>[]): Check<T> => v => {
  for (const check of checks) {
    const checked = check(v);
    if (checked !== FAIL) return checked;
  }
  return FAIL;
};

/** A check built on demand, for shapes that contain themselves. */
export const lazy = <T>(make: () => Check<T>): Check<T> => v => make()(v);
