// Minimal browser test harness. Suites import `test` and the assertions,
// register their cases as the module loads, and main.js calls report() once
// everything has run.

export const results = [];

export function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message }); }
}

export function eq(actual, expected, what = '') {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what} expected ${b}, got ${a}`);
}

export function ok(cond, what) { if (!cond) throw new Error(what || 'expected truthy'); }
export function no(cond, what) { if (cond) throw new Error(what || 'expected falsy'); }

// Asserts a throw, and optionally that the message explains the right thing.
export function throws(fn, contains, what) {
  try { fn(); } catch (e) {
    if (contains && !e.message.toLowerCase().includes(contains.toLowerCase())) {
      throw new Error(`${what || ''} threw the wrong reason: ${e.message}`);
    }
    return;
  }
  throw new Error(what || 'expected a throw');
}

export function section(title) { results.push({ section: title }); }

export function report() {
  const cases = results.filter((r) => !r.section);
  const passed = cases.filter((r) => r.ok).length;
  const failed = cases.length - passed;

  document.getElementById('out').innerHTML = results.map((r) => {
    if (r.section) return `<div class="section">${r.section}</div>`;
    return `<div class="${r.ok ? 'pass' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'} — ${r.name}` +
           `${r.ok ? '' : `<div class="err">${r.error}</div>`}</div>`;
  }).join('');

  const summary = `${passed} passed, ${failed} failed, ${cases.length} total`;
  document.getElementById('summary').textContent = summary;
  document.title = failed ? `FAIL (${failed})` : `PASS (${passed})`;
  console.log(`TEST_SUMMARY ${summary}`);
  cases.filter((r) => !r.ok).forEach((r) => console.error(`FAILED: ${r.name} :: ${r.error}`));
}
