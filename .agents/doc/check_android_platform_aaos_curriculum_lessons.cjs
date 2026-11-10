const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(__dirname + '/android_platform_aaos_curriculum_lessons.html', 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
const key = 'android-aaos-curriculum-v2';
const data = new Map([[key, JSON.stringify({ hours: { '2026-11-09': 1 }, evidence: { 'day_2026-11-09': 'Lesson cũ' }, lessonHistory: { CPP101: [] } })]]);
let nextId = 0;
function load() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', className: '', classList: { toggle() {}, remove() {} }, checkValidity() { return true }, reportValidity() {}, focus() {} });
      return elements.get(id);
    },
  };
  const context = vm.createContext({ document, localStorage: { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) }, crypto: { randomUUID: () => `id-${++nextId}` }, URL, console, confirm: () => true });
  vm.runInContext(script, context);
  return { context, document, run: code => vm.runInContext(code, context) };
}
const page = load();
const get = id => page.document.getElementById(id);
assert.match(get('bodyView').innerHTML, /Chưa rõ ngày thực học · 1 giờ/);
assert.match(get('bodyView').innerHTML, /Lesson cũ/);
function add(hours, studiedOn) {
  get('actualHours').value = String(hours);
  get('studiedOn').value = studiedOn;
  get('lessonDay').value = 'Học bù';
  page.run("saveDay('2026-11-09')");
}
add(0.5, '2026-11-10');
add(0.5, '2026-11-11');
assert.match(get('bodyView').innerHTML, /Đã học 2\/18 giờ · Còn 16 giờ/);
assert.match(get('bodyView').innerHTML, /Lịch sử học \(3\)/);
assert.equal(JSON.parse(data.get(key)).sessions['2026-11-09'].length, 3);
page.run("editSession('2026-11-09','id-1')");
assert.equal(get('actualHours').value, 0.5);
get('actualHours').value = '1';
page.run("saveDay('2026-11-09')");
assert.match(get('bodyView').innerHTML, /Đã học 2.5\/18 giờ · Còn 15.5 giờ/);
page.run("removeSession('2026-11-09','id-2')");
assert.equal(JSON.parse(data.get(key)).sessions['2026-11-09'].length, 2);
assert.match(get('bodyView').innerHTML, /Đã học 2\/18 giờ · Còn 16 giờ/);
const beforeInvalid = data.get(key);
get('actualHours').value = '0';
get('actualHours').checkValidity = () => false;
page.run("saveDay('2026-11-09')");
assert.equal(data.get(key), beforeInvalid);
get('actualHours').checkValidity = () => true;
get('actualHours').value = '0.5';
get('studiedOn').value = '2026-11-12';
page.run("saveDay('2026-11-09')");
assert.equal(JSON.parse(data.get(key)).sessions['2026-11-09'].length, 3);
page.run("editSession('2026-11-09','legacy-2026-11-09')");
assert.equal(get('studiedOn').value, '');
assert.match(get('bodyView').innerHTML, /Chưa rõ ngày thực học/);
page.run('cancelSessionEdit()');
page.run("removeSession('2026-11-09','id-3')");
assert.equal(JSON.parse(data.get(key)).sessions['2026-11-09'].length, 2);
const exported = JSON.parse(data.get(key));
assert.equal(exported.lessonHistory.CPP101.length, 0);
assert.equal(exported.sessions['2026-11-09'].length, 2);
assert.match(load().document.getElementById('bodyView').innerHTML, /Lịch sử học \(2\)/);
const legacy = { hours: { '2026-11-10': 0.5 }, evidence: { 'day_2026-11-10': 'Ghi chú cũ' } };
(async () => {
  const importer = get('importer');
  importer.files = [{ text: async () => JSON.stringify(legacy) }];
  await importer.onchange({ target: importer });
  assert.equal(JSON.parse(data.get(key)).sessions['2026-11-10'][0].studiedOn, null);
  assert.equal(JSON.parse(data.get(key)).sessions['2026-11-10'][0].note, 'Ghi chú cũ');
  importer.files = [{ text: async () => JSON.stringify(exported) }];
  await importer.onchange({ target: importer });
  assert.equal(JSON.parse(data.get(key)).sessions['2026-11-09'].length, 2);
})().catch(error => { console.error(error); process.exitCode = 1 });
