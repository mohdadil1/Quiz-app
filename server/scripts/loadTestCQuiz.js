require('dotenv').config();

const API_URL = (process.env.LOAD_TEST_API_URL || 'https://quiz-app-backend-cb2q.onrender.com/api').replace(/\/$/, '');
const teacherEmail = process.env.LOAD_TEST_TEACHER_EMAIL || 'admin@example.com';
const teacherPassword = process.env.LOAD_TEST_TEACHER_PASSWORD || 'admin';
const studentCount = Number(process.env.LOAD_TEST_STUDENTS || 80);
const slowNetworkDelayMs = Number(process.env.LOAD_TEST_SLOW_DELAY_MS || 0);
const runId = Date.now().toString(36);

const questions = [
  ['Which keyword declares an integer variable in C?', 'int', 'integer', 'num', 'var', 'a'],
  ['Which function is the usual entry point of a C program?', 'start', 'main', 'begin', 'run', 'b'],
  ['Which header declares printf?', 'string.h', 'stdlib.h', 'stdio.h', 'math.h', 'c'],
  ['What does the ampersand operator return when used with a variable?', 'Its value', 'Its address', 'Its type', 'Its size', 'b'],
  ['Which loop always executes its body at least once?', 'for', 'while', 'do-while', 'foreach', 'c'],
  ['Which format specifier prints an integer?', '%f', '%c', '%s', '%d', 'd'],
  ['What is the first index of a C array?', '0', '1', '-1', 'It depends', 'a'],
  ['Which operator accesses a structure member through a pointer?', '.', '->', '::', '*.', 'b'],
  ['Which storage class keeps a local variable between function calls?', 'auto', 'register', 'static', 'extern', 'c'],
  ['What does malloc return?', 'An integer', 'A character', 'A pointer to allocated memory', 'A file handle', 'c'],
  ['Which function releases memory allocated by malloc?', 'release', 'delete', 'remove', 'free', 'd'],
  ['Which header declares malloc and free?', 'stdio.h', 'stdlib.h', 'memory.h', 'alloc.h', 'b'],
  ['What does strcmp return when two strings are equal?', '1', '-1', '0', 'The string length', 'c'],
  ['Which symbol begins a single-line comment in C99?', '//', '#', '--', '/*', 'a'],
  ['Which preprocessor directive includes a header file?', '#define', '#include', '#import', '#header', 'b'],
  ['What is the size of char in C?', '1 byte', '2 bytes', '4 bytes', 'It is always 8 bytes', 'a'],
  ['Which keyword prevents a variable from being modified through its name?', 'fixed', 'readonly', 'const', 'locked', 'c'],
  ['What does sizeof return?', 'A pointer', 'A size in bytes', 'A type name', 'A memory address', 'b'],
  ['Which function reads formatted input from standard input?', 'puts', 'scanf', 'readline', 'input', 'b'],
  ['What is recursion?', 'A compiler warning', 'A function calling itself', 'A pointer error', 'A loop keyword', 'b']
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, options = {}, delayMs = 0) {
  if (delayMs > 0) await sleep(delayMs);
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${body.message || text}`);
  }
  return body;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function main() {
  const startedAt = Date.now();
  const teacher = await request('/teachers/login', {
    method: 'POST',
    body: JSON.stringify({ email: teacherEmail, password: teacherPassword })
  });
  const teacherHeaders = authHeaders(teacher.token);

  const classData = await request('/classes', {
    method: 'POST',
    headers: teacherHeaders,
    body: JSON.stringify({
      name: `C Load Test ${runId}`,
      startingRollNumber: 1,
      endingRollNumber: studentCount
    })
  });

  const test = await request('/tests', {
    method: 'POST',
    headers: teacherHeaders,
    body: JSON.stringify({
      name: `C Language Concurrent Test ${runId}`,
      subject: 'C Programming',
      date: new Date().toISOString().slice(0, 10),
      totalQuestions: questions.length,
      status: 'RUNNING',
      mode: 'STANDARD',
      webcamProctoring: false,
      classId: classData.class._id
    })
  });

  for (const [title, optionA, optionB, optionC, optionD, correctAns] of questions) {
    await request('/questions', {
      method: 'POST',
      headers: teacherHeaders,
      body: JSON.stringify({
        testId: test._id,
        title,
        optionA,
        optionB,
        optionC,
        optionD,
        correctAns,
        score: 1,
        timeLimit: 5
      })
    });
  }

  const credentials = await request(`/tests/${test._id}/credentials`, { headers: teacherHeaders });
  const loginStartedAt = Date.now();
  const loginResults = await Promise.allSettled(credentials.map((student) => request('/students/login', {
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
  }, slowNetworkDelayMs)));
  const loginSuccesses = loginResults.filter((result) => result.status === 'fulfilled');
  const loginFailures = loginResults.filter((result) => result.status === 'rejected');

  const questionStartedAt = Date.now();
  const questionResults = await Promise.allSettled(loginSuccesses.map((result) => request('/students/quiz/questions', {
    headers: authHeaders(result.value.token)
  }, slowNetworkDelayMs)));
  const questionSuccesses = questionResults.filter((result) => result.status === 'fulfilled');
  const questionFailures = questionResults.filter((result) => result.status === 'rejected');
  const questionLists = questionSuccesses.map((result) => result.value);
  const uniqueQuestionChecks = questionLists.map((list) => ({
    count: list.length,
    uniqueIds: new Set(list.map((question) => String(question._id))).size
  }));
  const uniqueQuestionLists = uniqueQuestionChecks.filter(
    (check) => check.count === questions.length && check.uniqueIds === questions.length
  ).length;
  const questionOrders = new Set(questionLists.map((list) => list.map((question) => question._id).join(',')));

  const violationToken = loginSuccesses[0]?.value?.token;
  const violationTypes = ['tab-switch', 'fullscreen-exit', 'camera-disabled'];
  const violationResults = [];
  if (violationToken) {
    for (const type of violationTypes) {
      const result = await request('/students/quiz/violation', {
        method: 'POST',
        headers: authHeaders(violationToken),
        body: JSON.stringify({ type })
      });
      violationResults.push({ type, count: result.violations });
    }
  }
  const updatedCredentials = await request(`/tests/${test._id}/credentials`, { headers: teacherHeaders });
  const violationStudent = updatedCredentials.find((student) => student.rollno === credentials[0]?.rollno);
  const violationDetailsRecorded = violationTypes.every((type) =>
    (violationStudent?.violationTypes || []).includes(type)
  );
  const elapsed = Date.now() - startedAt;

  console.log(JSON.stringify({
    api: API_URL,
    slowNetworkDelayMs,
    testId: test._id,
    classId: classData.class._id,
    studentsCreated: classData.studentsCreated,
    questionsCreated: questions.length,
    concurrentLogin: {
      requested: credentials.length,
      succeeded: loginSuccesses.length,
      failed: loginFailures.length,
      durationMs: Date.now() - loginStartedAt
    },
    concurrentQuestionFetch: {
      requested: loginSuccesses.length,
      succeeded: questionSuccesses.length,
      failed: questionFailures.length,
      durationMs: Date.now() - questionStartedAt,
      uniqueQuestionLists,
      distinctQuestionOrders: questionOrders.size
    },
    violationCheck: {
      results: violationResults,
      detailsRecorded: violationDetailsRecorded,
      storedTypes: violationStudent?.violationTypes || []
    },
    totalDurationMs: elapsed
  }, null, 2));

  if (
    loginFailures.length ||
    questionFailures.length ||
    uniqueQuestionLists !== questionSuccesses.length ||
    violationResults.some((result, index) => result.count !== index + 1) ||
    !violationDetailsRecorded
  ) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[load-test] ${error.message}`);
  process.exitCode = 1;
});