import { getShiftEditorState, shouldApplyEmployeeDefault } from './shiftFormState';

test('preserves an initial edit role and a manually selected role across reactive employee updates', () => {
  expect(shouldApplyEmployeeDefault('employee-a', 'employee-a', true)).toBe(false);
  expect(shouldApplyEmployeeDefault('employee-a', 'employee-a', false)).toBe(false);
});

test('applies defaults only after an actual employee selection change and loaded data', () => {
  expect(shouldApplyEmployeeDefault(undefined, 'employee-a', false)).toBe(false);
  expect(shouldApplyEmployeeDefault(undefined, 'employee-a', true)).toBe(true);
  expect(shouldApplyEmployeeDefault('employee-a', 'employee-b', true)).toBe(true);
  expect(shouldApplyEmployeeDefault('employee-a', undefined, true)).toBe(true);
});

test('missing or deleted shifts show not found even when the dependent query is skipped', () => {
  expect(getShiftEditorState(null, undefined)).toEqual({ status: 'not-found' });
  expect(getShiftEditorState(null, [])).toEqual({ status: 'not-found' });
  expect(getShiftEditorState(undefined, undefined)).toEqual({ status: 'loading' });
  expect(getShiftEditorState({ id: 'shift' }, undefined)).toEqual({ status: 'loading' });
  expect(getShiftEditorState({ id: 'shift' }, [])).toEqual({ status: 'ready', shift: { id: 'shift' }, dayShifts: [] });
});
