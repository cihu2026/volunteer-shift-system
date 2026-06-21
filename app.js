const API_URL = 'https://script.google.com/macros/s/AKfycbxQj4g1Ee-3TGL7iikQ49cQD3bYCUBzcp_L_3T01BjMvKFp1VC9lM9oM8sOwC7Bi1TF/exec';

const state = {
  publicData: null,
  teacherKey: '',
  teacherResult: null
};

function showApiStatus(message, type = 'hint') {
  const el = document.querySelector('#apiStatus');
  if (!el) return;
  el.className = type;
  el.textContent = message;
}

function apiGet(params) {
  return new Promise((resolve, reject) => {
    const callbackName = 'volunteerShiftCallback_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const url = new URL(API_URL);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
    url.searchParams.set('callback', callbackName);
    url.searchParams.set('_', Date.now());

    const script = document.createElement('script');
    let finished = false;
    const timer = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error('後端逾時，請確認 Apps Script 是否已部署為「任何人可存取」。'));
    }, 20000);

    function cleanup() {
      window.clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (payload) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (!payload || !payload.ok) {
        reject(new Error(payload && payload.error ? payload.error : '後端回傳錯誤。'));
        return;
      }
      resolve(payload.data);
    };

    script.onerror = () => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error('無法連線 Apps Script，請檢查 Web App URL 或部署權限。'));
    };

    script.src = url.toString();
    document.body.appendChild(script);
  });
}

async function loadPublicData() {
  showApiStatus('正在載入 8 月線上排班月曆...', 'hint');
  renderMessage('#shiftList', '載入月曆中...');
  renderMessage('#adminPanel', '載入公開檢查資料中...');
  try {
    const data = await apiGet({ action: 'getPublicData' });
    state.publicData = normalizePublicData(data);
    renderShiftCalendar();
    renderAdminPanel();
    showApiStatus('後端連線正常，已載入 8 月線上排班。資料時間：' + formatDateTime(data.generatedAt), 'success-text');
  } catch (error) {
    showApiStatus('連線失敗：' + error.message, 'danger-text');
    renderMessage('#shiftList', error.message);
    renderMessage('#adminPanel', '請先確認 Apps Script 已部署，且存取權是「任何人」。');
  }
}

function normalizePublicData(data) {
  const normalized = { ...data };
  normalized.shifts = (data.shifts || []).map((shift) => ({
    ...shift,
    date: normalizeDateKey(shift.date)
  })).filter((shift) => Boolean(shift.date));
  normalized.selections = data.selections || [];
  normalized.swaps = data.swaps || [];
  return normalized;
}

function normalizeDateKey(value) {
  const text = String(value || '').trim();
  const matched = text.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!matched) return '';
  return `${matched[1]}/${String(Number(matched[2])).padStart(2, '0')}/${String(Number(matched[3])).padStart(2, '0')}`;
}

function useTypedTeacherKey() {
  const input = document.querySelector('#queryInput');
  state.teacherKey = input ? input.value.trim() : '';
  if (state.publicData) renderShiftCalendar();
}

async function queryMySchedule() {
  const input = document.querySelector('#queryInput');
  const key = input.value.trim();
  if (!key) {
    state.teacherKey = '';
    renderMessage('#mySchedule', '請先輸入學號或姓名。');
    renderShiftCalendar();
    return;
  }

  state.teacherKey = key;
  renderShiftCalendar();
  renderMessage('#mySchedule', '查詢中...');

  try {
    const data = await apiGet({ action: 'lookupTeacher', teacherKey: key });
    if (data && data.selections) {
      data.selections = data.selections.map((selection) => ({
        ...selection,
        shift: selection.shift ? { ...selection.shift, date: normalizeDateKey(selection.shift.date) } : selection.shift
      }));
    }
    state.teacherResult = data;
    renderMySchedule();
    await loadPublicData();
  } catch (error) {
    state.teacherResult = null;
    renderMessage('#mySchedule', error.message + '（可以先確認是否已按「從原表匯入學號姓名」。）');
    renderShiftCalendar();
  }
}

async function selectShift(shiftId) {
  const key = state.teacherKey || document.querySelector('#queryInput').value.trim();
  if (!key) {
    alert('請先輸入學號或姓名，再選班。');
    return;
  }

  try {
    const result = await apiGet({ action: 'selectShift', teacherKey: key, shiftId });
    alert(result.message || '選班成功。');
    await queryMySchedule();
  } catch (error) {
    alert(error.message);
    await loadPublicData();
  }
}

async function confirmSelection(selectionId, shiftId) {
  const key = state.teacherKey || document.querySelector('#queryInput').value.trim();
  if (!key) {
    alert('請先輸入學號或姓名。');
    return;
  }
  try {
    const result = await apiGet({ action: 'confirmShift', teacherKey: key, selectionId, shiftId });
    alert(result.message || '已確認。');
    await queryMySchedule();
  } catch (error) {
    alert(error.message);
  }
}

async function requestSwap(originalShiftId) {
  const key = state.teacherKey || document.querySelector('#queryInput').value.trim();
  if (!key) {
    alert('請先輸入學號或姓名。');
    return;
  }
  const desiredShiftId = prompt('想換到哪一班？可填班別代碼，例如 AUG031；不確定可留空。', '') || '';
  const note = prompt('換班備註，例如：想找人互換、那天臨時有事。', '') || '';
  try {
    const result = await apiGet({ action: 'requestSwap', teacherKey: key, originalShiftId, desiredShiftId, note });
    alert(result.message || '已建立換班申請。');
    await loadPublicData();
  } catch (error) {
    alert(error.message);
  }
}

async function setupBackend() {
  showApiStatus('正在建立後端工作表...', 'hint');
  try {
    const data = await apiGet({ action: 'setup' });
    showApiStatus(data.message || '後端工作表已建立完成。', 'success-text');
    await loadPublicData();
  } catch (error) {
    showApiStatus('建立失敗：' + error.message, 'danger-text');
  }
}

async function importTeachers() {
  showApiStatus('正在從原始表掃描「學號／姓名」並匯入 Teachers...', 'hint');
  try {
    const data = await apiGet({ action: 'importTeachers' });
    showApiStatus(`匯入完成：新增 ${data.imported} 位，目前共 ${data.totalTeachers} 位。`, 'success-text');
    await loadPublicData();
  } catch (error) {
    showApiStatus('匯入失敗：' + error.message, 'danger-text');
  }
}

function renderMySchedule() {
  const target = document.querySelector('#mySchedule');
  const data = state.teacherResult;
  if (!data || !data.teacher) {
    renderMessage('#mySchedule', '請輸入學號或姓名查詢。');
    return;
  }

  const teacher = data.teacher;
  const selections = data.selections || [];
  if (selections.length === 0) {
    target.innerHTML = `<div class="empty">${escapeHtml(teacher.name)} 目前尚未選班。請往下看 8 月月曆選班。</div>`;
    return;
  }

  target.innerHTML = selections.map((item) => {
    const shift = item.shift || {};
    const statusClass = isTrue(item.confirmed) ? 'ok' : 'warn';
    const statusText = isTrue(item.confirmed) ? '已確認收到提醒' : '尚未確認';
    return `
      <article class="card">
        <div class="card-title-row">
          <h3>${escapeHtml(shift.date || '')}｜${escapeHtml(shift.site || '')} ${escapeHtml(shift.duty || '')}</h3>
          <span class="badge ${statusClass}">${statusText}</span>
        </div>
        <p><strong>班別代碼：</strong>${escapeHtml(item.shiftId)}</p>
        <p><strong>服務時間：</strong>${escapeHtml(shift.startTime || '')}－${escapeHtml(shift.endTime || '')}</p>
        <p><strong>報到時間：</strong>${escapeHtml(shift.reportTime || '')}</p>
        ${isTrue(item.confirmed)
          ? `<p class="hint">確認時間：${escapeHtml(formatDateTime(item.confirmedAt))}</p>`
          : `<button class="secondary" type="button" onclick="confirmSelection('${escapeAttr(item.selectionId)}', '${escapeAttr(item.shiftId)}')">我知道了</button>`}
        <button type="button" onclick="requestSwap('${escapeAttr(item.shiftId)}')">我要申請換班</button>
      </article>
    `;
  }).join('');
}

function renderShiftCalendar() {
  const target = document.querySelector('#shiftList');
  const data = state.publicData;
  if (!data || !Array.isArray(data.shifts)) {
    renderMessage('#shiftList', '尚未載入公開班表。');
    return;
  }

  const shifts = data.shifts.slice().sort((a, b) => {
    const dateCompare = String(a.date).localeCompare(String(b.date));
    if (dateCompare !== 0) return dateCompare;
    return String(a.startTime).localeCompare(String(b.startTime));
  });
  if (shifts.length === 0) {
    target.innerHTML = '<div class="empty">目前沒有可選班別。</div>';
    return;
  }

  const selectedShiftIds = new Set(((state.teacherResult && state.teacherResult.selections) || []).map((item) => item.shiftId));
  const shiftsByDate = groupBy(shifts, 'date');
  const monthLabel = getMonthLabel(shifts[0].date);
  const [year, month] = shifts[0].date.split('/').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDay = new Date(year, month - 1, 1).getDay();
  const cells = [];
  for (let i = 0; i < firstDay; i += 1) cells.push('<div class="calendar-day empty-day"></div>');

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
    const date = new Date(year, month - 1, day);
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
    const dayShifts = shiftsByDate[dateKey] || [];
    const isTuesday = weekday === '二';
    const shiftHtml = dayShifts.length
      ? dayShifts.map((shift) => renderShiftInCalendar(shift, selectedShiftIds)).join('')
      : `<div class="rest-note">${isTuesday ? '休園｜不排老師' : '尚未開放'}</div>`;

    cells.push(`
      <div class="calendar-day ${isTuesday ? 'rest-day' : ''}">
        <div class="day-number"><strong>${day}</strong><span>${weekday}</span></div>
        <div class="shift-stack">${shiftHtml}</div>
      </div>
    `);
  }

  const loginHint = state.teacherKey
    ? `目前以「${escapeHtml(state.teacherKey)}」選班。看到想要的班，直接按「選」。`
    : '先在上方輸入學號或姓名；輸入後月曆裡會出現「選」按鈕。';

  target.innerHTML = `
    <div class="month-toolbar">
      <div>
        <h3>${escapeHtml(monthLabel)} 線上排班月曆</h3>
        <p class="hint">週二休園不排老師；其他日期都開放選班。${loginHint}</p>
      </div>
      <span class="badge ok">共 ${shifts.length} 個可選班別</span>
    </div>
    <div class="calendar-wrap">
      <div class="calendar-grid calendar-head">
        ${['日', '一', '二', '三', '四', '五', '六'].map((w) => `<div>${w}</div>`).join('')}
      </div>
      <div class="calendar-grid">${cells.join('')}</div>
    </div>
  `;
}

function renderShiftInCalendar(shift, selectedShiftIds) {
  const full = Number(shift.remaining) <= 0;
  const alreadySelected = selectedShiftIds.has(shift.shiftId);
  const hasKey = Boolean(state.teacherKey);
  const disabled = full || alreadySelected || !hasKey;
  const people = (shift.selectedPeople || []).map((person) => `${escapeHtml(person.teacherName)}${isTrue(person.confirmed) ? '✅' : '⚠️'}`).join('、') || '尚無人';
  const statusText = alreadySelected ? '已選' : full ? '滿' : hasKey ? '選' : '輸入後選';

  return `
    <div class="shift-pill ${full ? 'full' : ''} ${alreadySelected ? 'selected' : ''}">
      <div class="shift-pill-main">
        <span class="shift-code">${escapeHtml(shift.shiftId)}</span>
        <strong>${escapeHtml(shift.duty)}</strong>
      </div>
      <div class="shift-time">${escapeHtml(shift.startTime)}－${escapeHtml(shift.endTime)}｜${escapeHtml(shift.site)}</div>
      <div class="shift-people">${people}</div>
      <div class="shift-action-row">
        <span class="mini-badge">${escapeHtml(shift.selectedCount)} / ${escapeHtml(shift.quota)}</span>
        <button class="mini-button" type="button" ${disabled ? 'disabled' : ''} onclick="selectShift('${escapeAttr(shift.shiftId)}')">${statusText}</button>
      </div>
    </div>
  `;
}

function renderAdminPanel() {
  const panel = document.querySelector('#adminPanel');
  const data = state.publicData;
  if (!data) {
    renderMessage('#adminPanel', '尚未載入公開資料。');
    return;
  }

  const shiftsById = new Map((data.shifts || []).map((shift) => [String(shift.shiftId), shift]));
  const selections = data.selections || [];
  const swaps = data.swaps || [];
  const selectionRows = selections.length
    ? selections.map((item) => {
        const shift = shiftsById.get(String(item.shiftId)) || {};
        const statusClass = isTrue(item.confirmed) ? 'ok' : 'warn';
        const statusText = isTrue(item.confirmed) ? '已確認' : '未確認';
        return `
          <tr>
            <td>${escapeHtml(item.teacherName)}<br><span class="hint">${escapeHtml(item.teacherId)}</span></td>
            <td>${escapeHtml(item.shiftId)}<br>${escapeHtml(shift.date || '')} ${escapeHtml(shift.site || '')} ${escapeHtml(shift.duty || '')}</td>
            <td>${escapeHtml(shift.startTime || '')}－${escapeHtml(shift.endTime || '')}</td>
            <td><span class="badge ${statusClass}">${statusText}</span></td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="4">目前沒有任何選班紀錄。</td></tr>';
  const swapRows = swaps.length
    ? swaps.map((item) => `
        <tr>
          <td>${escapeHtml(item.teacherName)}<br><span class="hint">${escapeHtml(item.teacherId)}</span></td>
          <td>${escapeHtml(item.originalShiftId)}</td>
          <td>${escapeHtml(item.desiredShiftId || '未指定')}</td>
          <td>${escapeHtml(item.note || '')}<br><span class="badge warn">${escapeHtml(item.status || 'open')}</span></td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">目前沒有換班申請。</td></tr>';

  panel.innerHTML = `
    <h3>選班與確認狀態</h3>
    <table><thead><tr><th>人員</th><th>班別</th><th>時間</th><th>確認</th></tr></thead><tbody>${selectionRows}</tbody></table>
    <h3>換班申請</h3>
    <table><thead><tr><th>人員</th><th>原班別</th><th>想換到</th><th>備註／狀態</th></tr></thead><tbody>${swapRows}</tbody></table>
  `;
}

function groupBy(rows, key) {
  return rows.reduce((acc, row) => {
    const groupKey = row[key];
    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(row);
    return acc;
  }, {});
}

function getMonthLabel(dateString) {
  const [year, month] = String(dateString).split('/');
  return `${year} 年 ${Number(month)} 月`;
}

function renderMessage(selector, message) {
  const el = document.querySelector(selector);
  if (el) el.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function isTrue(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}

function init() {
  showApiStatus('後端網址已寫入前端，正在連線...', 'hint');
  renderMessage('#mySchedule', '請輸入學號或姓名查詢。');
  renderMessage('#shiftList', '載入 8 月月曆中...');
  renderMessage('#adminPanel', '載入公開檢查資料中...');
  loadPublicData();
}

document.querySelector('#refreshBtn').addEventListener('click', loadPublicData);
document.querySelector('#searchBtn').addEventListener('click', queryMySchedule);
document.querySelector('#queryInput').addEventListener('input', useTypedTeacherKey);
document.querySelector('#queryInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') queryMySchedule();
});
document.querySelector('#setupBackendBtn').addEventListener('click', setupBackend);
document.querySelector('#importTeachersBtn').addEventListener('click', importTeachers);

init();
