import { createFormValidator, type FormResult } from '@lp-labs/form-validation-core';
interface Values {
  name: string;
  age: number;
}
const form = createFormValidator<Values>({
  name: { sync: [(value) => (value === '' ? [{ code: 'required' }] : [])] },
});
const result: FormResult<Values> = form.validateSync({ name: '', age: 1 });
result.errors.name?.[0]?.code.toUpperCase();
form.validate({ name: 'Ada', age: 2 }).then((run) => {
  if (run.status === 'completed') run.result.valid.valueOf();
});
// @ts-expect-error typed values cannot contain wrong age
form.validateSync({ name: 'Ada', age: '2' });
// @ts-expect-error typed field errors have no unknown field
result.errors.unknown;
// @ts-expect-error only declared fields may have rules
createFormValidator<Values>({ absent: {} });
