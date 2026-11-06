# @lp-labs/form-validation-core

Typed headless sync and async field-rule execution with snapshots, cancellation and stale-generation suppression. Catalog identity 430; standalone package version 0.1.0.
No runtime, peer, or sibling dependencies. Node >=18, ESM and CommonJS with declarations.

## Install

```sh
npm install @lp-labs/form-validation-core
```

## Quickstart (runnable JavaScript)

```js
import assert from 'node:assert/strict';
import { createFormValidator } from '@lp-labs/form-validation-core';
const form = createFormValidator({
  name: {
    sync: [(value) => (value === '' ? [{ code: 'required' }] : [])],
    async: [async (_value, _values, signal) => (signal.aborted ? [] : [])],
  },
});
assert.equal(form.validateSync({ name: '' }).errors.name[0].code, 'required');
const run = await form.validate({ name: 'Ada' });
assert.equal(run.status, 'completed');
assert.equal(run.result.valid, true);
assert.equal(form.latest(), run.result);
```

## Customization and errors

Supply per-field sync and async rule arrays returning FieldIssue arrays (code plus optional message). Values are flat bounded scalar records, copied and frozen per run. Rules and returned issues are copied; reports are frozen. Rules execute deterministically in field insertion and array order, async rules sequentially, even after sync errors. validateSync is a pure check and neither cancels nor commits. Each validate cancels the previous async run, which returns stale and cannot replace latest; abort or an external AbortSignal returns aborted. Only completed async runs commit latest.

## Complete public declarations

Every runtime export and public type is shown below. This is the complete emitted declaration surface.

```ts
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
  | {
      readonly status: 'completed';
      readonly result: FormResult<T>;
    }
  | {
      readonly status: 'aborted' | 'stale';
    };
export interface FormValidator<T> {
  validateSync(values: T): FormResult<T>;
  validate(values: T, signal?: AbortSignal): Promise<FormRun<T>>;
  latest(): FormResult<T> | undefined;
  abort(): void;
}
export declare function createFormValidator<
  T extends {
    [K in keyof T]: FieldValue;
  },
>(rules: FieldRules<T>): FormValidator<T>;
```

## Performance, boundaries and limitations

At most 256 fields/values, 32 rules per kind per field, 100 issues per rule, 65536 units per string value. O(fields + rule/issue work) core time and O(snapshot + issues) space; rule execution cost is caller-controlled. Aborting promptly races rules even if they ignore the signal; their underlying work is not forcibly terminated and should cooperate. Errors thrown by rules (including undefined) propagate unchanged for the current run, but stale/aborted runs return diagnostics. Invalid config, nonfinite/nonscalar/accessor values, missing configured fields or malformed issues throw TypeError; field count throws RangeError. No DOM, event handlers, deep objects, hidden schemas, UI messages, or built-in validation policy.

## Development

```sh
npm ci --offline
npm run build
npm run typecheck
npm test
npm run format:check
```

The offline install requires the locked development dependencies already in the npm cache.
Build emits separate ESM/CJS and declarations; type checks include bare-package .mts/.cts consumers with negative cases.
Runtime tests import only the single-quoted standalone dist entry and also run against installed offline tarballs.
No build artifacts or development dependencies are required at runtime.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
