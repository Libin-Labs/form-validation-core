export type FieldValue = string | number | boolean | null;
export interface FieldIssue {
  readonly code: string;
  readonly message?: string;
}
export type SyncFieldRule<T, K extends keyof T = keyof T> = (
  value: T[K],
  values: Readonly<T>,
) => readonly FieldIssue[];
export type AsyncFieldRule<T, K extends keyof T = keyof T> = (
  value: T[K],
  values: Readonly<T>,
  signal: AbortSignal,
) => Promise<readonly FieldIssue[]>;
export type FieldRules<T> = {
  readonly [K in keyof T]?: {
    readonly sync?: readonly SyncFieldRule<T, K>[];
    readonly async?: readonly AsyncFieldRule<T, K>[];
  };
};
export interface FormResult<T> {
  readonly valid: boolean;
  readonly errors: Readonly<Partial<Record<keyof T, readonly FieldIssue[]>>>;
}
export type FormRun<T> =
  | { readonly status: 'completed'; readonly result: FormResult<T> }
  | { readonly status: 'aborted' | 'stale' };
export interface FormValidator<T> {
  validateSync(values: T): FormResult<T>;
  validate(values: T, signal?: AbortSignal): Promise<FormRun<T>>;
  latest(): FormResult<T> | undefined;
  abort(): void;
}
function plain(input: unknown): asserts input is Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(input))
  )
    throw new TypeError('Expected a plain record.');
  for (const key of Reflect.ownKeys(input)) {
    const d = Object.getOwnPropertyDescriptor(input, key)!;
    if (
      typeof key !== 'string' ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      !d.enumerable ||
      !('value' in d)
    )
      throw new TypeError('Only safe own data fields are supported.');
  }
}
export function createFormValidator<T extends { [K in keyof T]: FieldValue }>(
  rules: FieldRules<T>,
): FormValidator<T> {
  plain(rules);
  const entries = Object.entries(rules);
  if (entries.length > 256) throw new RangeError('At most 256 fields.');
  const compiled = entries.map(([field, config]) => {
    plain(config);
    if (Object.keys(config).some((k) => !['sync', 'async'].includes(k)))
      throw new TypeError('Unknown rule kind.');
    const sync = config.sync ?? [],
      async = config.async ?? [];
    for (const list of [sync, async]) {
      if (
        !Array.isArray(list) ||
        list.length > 32 ||
        Array.from(list).some((rule) => typeof rule !== 'function')
      )
        throw new TypeError('Expected at most 32 rules of each kind per field.');
    }
    return {
      field: field as keyof T,
      sync: [...(sync as SyncFieldRule<T>[])],
      async: [...(async as AsyncFieldRule<T>[])],
    };
  });
  let generation = 0,
    controller: AbortController | undefined,
    latest: FormResult<T> | undefined;
  function snapshot(values: T): Readonly<T> {
    plain(values);
    if (Object.keys(values).length > 256) throw new RangeError('At most 256 values.');
    for (const v of Object.values(values)) {
      if (!(
        v === null ||
        typeof v === 'boolean' ||
        (typeof v === 'number' && Number.isFinite(v)) ||
        (typeof v === 'string' && v.length <= 65536)
      ))
        throw new TypeError('Values must be bounded strings, finite numbers, booleans, or null.');
    }
    for (const entry of compiled)
      if (!Object.hasOwn(values, entry.field)) throw new TypeError('Missing configured field.');
    return Object.freeze({ ...values });
  }
  function issues(value: readonly FieldIssue[]): readonly FieldIssue[] {
    if (!Array.isArray(value) || value.length > 100)
      throw new TypeError('Rules must return at most 100 issues.');
    return value.map((issue) => {
      plain(issue);
      if (
        Object.keys(issue).some((k) => !['code', 'message'].includes(k)) ||
        typeof issue.code !== 'string' ||
        !/^[A-Za-z0-9_.-]{1,64}$/.test(issue.code) ||
        (issue.message !== undefined &&
          (typeof issue.message !== 'string' || issue.message.length > 4096))
      )
        throw new TypeError('Invalid field issue.');
      return Object.freeze({
        code: issue.code,
        ...(issue.message === undefined ? {} : { message: issue.message }),
      });
    });
  }
  type Errors = Partial<Record<keyof T, readonly FieldIssue[]>>;
  function syncErrors(values: Readonly<T>): Errors {
    const errors: Errors = Object.create(null);
    for (const entry of compiled) {
      const list = entry.sync.flatMap((rule) => issues(rule(values[entry.field], values)));
      if (list.length) errors[entry.field] = list;
    }
    return errors;
  }
  function result(errors: Errors): FormResult<T> {
    for (const list of Object.values(errors)) Object.freeze(list);
    return Object.freeze({
      valid: Object.keys(errors).length === 0,
      errors: Object.freeze(errors),
    });
  }
  return Object.freeze({
    validateSync(values: T) {
      return result(syncErrors(snapshot(values)));
    },
    async validate(values: T, external?: AbortSignal): Promise<FormRun<T>> {
      const owned = snapshot(values),
        id = ++generation;
      controller?.abort();
      const local = new AbortController();
      controller = local;
      const onAbort = () => local.abort();
      if (external?.aborted) local.abort();
      external?.addEventListener('abort', onAbort, { once: true });
      const status = (): 'stale' | 'aborted' | undefined =>
        id !== generation ? 'stale' : local.signal.aborted ? 'aborted' : undefined;
      try {
        const early = status();
        if (early) return { status: early };
        const errors = syncErrors(owned);
        for (const entry of compiled) {
          for (const rule of entry.async) {
            const pending = rule(owned[entry.field], owned, local.signal);
            // Racing an abort lets callers finish even if a rule ignores its signal.
            const output = await new Promise<readonly FieldIssue[] | undefined>(
              (resolve, reject) => {
                const aborted = () => resolve(undefined);
                local.signal.addEventListener('abort', aborted, { once: true });
                Promise.resolve(pending)
                  .then(resolve, reject)
                  .finally(() => local.signal.removeEventListener('abort', aborted));
                if (local.signal.aborted) resolve(undefined);
              },
            );
            const stopped = status();
            if (stopped) return { status: stopped };
            const list = issues(output!);
            if (list.length) errors[entry.field] = [...(errors[entry.field] ?? []), ...list];
          }
        }
        const stopped = status();
        if (stopped) return { status: stopped };
        latest = result(errors);
        return { status: 'completed', result: latest };
      } catch (error) {
        const stopped = status();
        if (stopped) return { status: stopped };
        throw error;
      } finally {
        external?.removeEventListener('abort', onAbort);
      }
    },
    latest: () => latest,
    abort() {
      controller?.abort();
    },
  });
}
