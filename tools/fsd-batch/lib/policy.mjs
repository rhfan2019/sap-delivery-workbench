export function batchPrefix(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}-`;
}
export function resolveAnswers(decision, presets = []) {
  const values = {},
    missing = [],
    matched = [];
  for (const q of decision.questions) {
    const matches = presets.filter(
      (p) => p.question === q.title || (p.pattern && new RegExp(p.pattern, 'iu').test(q.title)),
    );
    const rule = matches[0];
    if (matches.length !== 1 || !rule) {
      missing.push({
        id: q.id,
        title: q.title,
        reason: matches.length > 1 ? 'ambiguous' : 'missing',
      });
      continue;
    }
    const option = rule.optionLabel && q.options.find((o) => o.label === rule.optionLabel);
    if (option) values[q.id] = option.value;
    else if (rule.text && q.allowText && rule.text.length <= 995)
      values[q.id] = 'text:' + rule.text;
    else {
      missing.push({ id: q.id, title: q.title, reason: 'invalid_preset' });
      continue;
    }
    matched.push({ question: q.title, rule, value: values[q.id] });
  }
  return { missing, matched, answer: missing.length ? null : { decisionId: decision.id, values } };
}
