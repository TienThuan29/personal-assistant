import { confirmDanger } from '../src/renderer/components/ui';

describe('confirmDanger', () => {
  it('asks with a specific OK label and the danger style', () => {
    const calls: Record<string, unknown>[] = [];
    const onOk = () => {};
    const modal = { confirm: (c: Record<string, unknown>) => void calls.push(c) };
    confirmDanger(modal as never, { title: 'Delete?', content: 'Buy milk', okText: 'Delete', onOk });
    expect(calls).toEqual([{ title: 'Delete?', content: 'Buy milk', okText: 'Delete', onOk, okButtonProps: { status: 'danger' } }]);
  });

  it('does nothing before the modal host is ready', () => {
    expect(confirmDanger({} as never, { title: 'x', okText: 'Delete', onOk: () => {} })).toBeUndefined();
  });
});
