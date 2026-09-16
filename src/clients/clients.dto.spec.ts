import { validateClient } from './clients.dto';

describe('client DTO validation', () => {
  it('normalizes supported customer fields', () => {
    expect(
      validateClient(
        { name: '  Nguyễn Văn A  ', phone: ' 0901 ', note: '' },
        true,
      ),
    ).toEqual({ name: 'Nguyễn Văn A', phone: '0901', note: null });
  });

  it('rejects ownership and unknown field injection', () => {
    expect(() =>
      validateClient({ name: 'A', user_id: 'foreign' }, true),
    ).toThrow('trường không được hỗ trợ');
  });

  it('rejects empty names and empty updates', () => {
    expect(() => validateClient({ name: ' ' }, true)).toThrow(
      'không được để trống',
    );
    expect(() => validateClient({}, false)).toThrow('Chưa có thông tin');
  });
});
