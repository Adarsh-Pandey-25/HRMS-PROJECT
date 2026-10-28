const {
  TEMPLATES, FOOTER, STOP_BUTTON_TEXT, paramCount, templateProblems, toCreatePayload, isMarketing,
} = require('../../src/services/whatsappTemplates');

describe('whatsappTemplates', () => {
  test.each(TEMPLATES.map((t) => [t.name, t]))('%s follows Meta’s template rules', (_name, template) => {
    expect(templateProblems(template)).toEqual([]);
    expect(template.example).toHaveLength(paramCount(template));
  });

  test('names are unique', () => {
    const names = TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('company news and celebrations are honestly MARKETING; everything else is UTILITY', () => {
    const marketing = TEMPLATES.filter(isMarketing).map((t) => t.name).sort();
    expect(marketing).toEqual([
      'birthday_wish', 'company_announcement', 'holiday_list', 'team_anniversary', 'team_birthday', 'work_anniversary',
    ]);
  });

  test('no template asks for money, passwords or codes', () => {
    for (const t of TEMPLATES) {
      expect(t.body).not.toMatch(/₹|\bINR\b|password|otp|\bcode\b|salary of|amount/i);
    }
  });

  test('the Meta payload has the body with samples, the STOP footer, and a stop button on marketing only', () => {
    const utility = toCreatePayload(TEMPLATES.find((t) => t.name === 'leave_approved'));
    expect(utility).toMatchObject({ name: 'leave_approved', language: 'en', category: 'UTILITY' });
    expect(utility.components[0]).toMatchObject({ type: 'BODY', example: { body_text: [expect.any(Array)] } });
    expect(utility.components[1]).toEqual({ type: 'FOOTER', text: FOOTER });
    expect(utility.components).toHaveLength(2);

    const news = toCreatePayload(TEMPLATES.find((t) => t.name === 'company_announcement'));
    expect(news.components[2]).toEqual({ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: STOP_BUTTON_TEXT }] });
  });

  test('templateProblems catches what Meta would reject', () => {
    expect(templateProblems({ name: 'x', category: 'UTILITY', body: '{{1}} hello', example: ['a'] })).toContain('body starts with a blank');
    expect(templateProblems({ name: 'x', category: 'UTILITY', body: 'Hello {{1}}.', example: ['a'] })).toContain('body ends with a blank');
    expect(templateProblems({ name: 'x', category: 'UTILITY', body: 'Hi {{1}} {{2}} there', example: ['a', 'b'] })).toContain('two blanks next to each other');
    expect(templateProblems({ name: 'x', category: 'UTILITY', body: 'Hi {{2}} there', example: ['a'] })).toContain('blanks must be numbered 1..n');
  });
});
