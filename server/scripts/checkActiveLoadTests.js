require('dotenv').config();

const API_URL = (process.env.LOAD_TEST_API_URL || 'https://quiz-app-backend-cb2q.onrender.com/api').replace(/\/$/, '');
const teacherEmail = process.env.LOAD_TEST_TEACHER_EMAIL || 'admin@example.com';
const teacherPassword = process.env.LOAD_TEST_TEACHER_PASSWORD || 'admin';
const violationTypes = ['tab-switch', 'fullscreen-exit', 'camera-disabled'];

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${body.message || text}`);
  return body;
}

const authHeaders = (token) => ({ Authorization: `Bearer ${token}` });

async function main() {
  const teacher = await request('/teachers/login', {
    method: 'POST',
    body: JSON.stringify({ email: teacherEmail, password: teacherPassword })
  });
  const headers = authHeaders(teacher.token);
  const tests = await request('/tests?status=running', { headers });
  const loadTests = tests.filter((test) => test.name.startsWith('C Language Concurrent Test '));
  const results = [];

  for (const test of loadTests) {
    const credentials = await request(`/tests/${test._id}/credentials`, { headers });
    const student = credentials[0];
    if (!student) {
      results.push({ testId: test._id, name: test.name, error: 'No student credentials' });
      continue;
    }

    const login = await request('/students/login', {
      method: 'POST',
      body: JSON.stringify({
        rollno: student.rollno,
        password: student.password,
        deviceInfo: {
          userAgent: `load-test-${student.rollno}`,
          platform: 'load-test',
          language: 'en-US',
          screenResolution: '1920x1080',
          timezone: 'UTC'
        }
      })
    });
    const studentHeaders = authHeaders(login.token);
    const events = [];
    for (const type of violationTypes) {
      events.push({ type, ...(await request('/students/quiz/violation', {
        method: 'POST',
        headers: studentHeaders,
        body: JSON.stringify({ type })
      })) });
    }

    const updatedCredentials = await request(`/tests/${test._id}/credentials`, { headers });
    const updatedStudent = updatedCredentials.find((row) => String(row.testStudentId) === String(student.testStudentId));
    const scoreboard = await request(`/tests/${test._id}/scoreboard`, { headers });
    const scoreRow = scoreboard.rows.find((row) => row.rollno === student.rollno);
    results.push({
      testId: test._id,
      name: test.name,
      studentRollno: student.rollno,
      violations: updatedStudent?.violations || 0,
      violationTypes: updatedStudent?.violationTypes || [],
      events,
      score: scoreRow?.score,
      submitted: scoreRow?.submitted,
      autoSubmitted: scoreRow?.autoSubmitted
    });
  }

  console.log(JSON.stringify({ api: API_URL, runningLoadTests: results.length, results }, null, 2));
  const valid = results.length > 0 && results.every((result) =>
    result.violations >= violationTypes.length &&
    violationTypes.every((type) => result.violationTypes.includes(type)) &&
    typeof result.score === 'number'
  );
  if (!valid) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[check-load-tests] ${error.message}`);
  process.exitCode = 1;
});