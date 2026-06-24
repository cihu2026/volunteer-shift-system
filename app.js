const API_URL = 'https://script.google.com/macros/s/AKfycbxQj4g1Ee-3TGL7iikQ49cQD3bYCUBzcp_L_3T01BjMvKFp1VC9lM9oM8sOwC7Bi1TF/exec';

const state = {
  publicData: null,
  teacherKey: '',
  teacherResult: null,
  expandedDates: new Set(),
  renderTimer: null
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
    Object.entries(params || {}).forEach(([key, value]) => {
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
      resolve(payload.data || {});
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

async function loadPublicData(options = {}) {
  const quiet = options.quiet === true;
  const forceRefresh = options.forceRefresh === true;
  if (!quiet) {
    showApiStatus('正在載入 8 月線上排班月曆...', 'hint');
    renderMessage('#shiftList', '載入月曆中...');
    renderMessage('#adminPanel', '載入公開檢查資料中...');
  }
  try {
    const data = await apiGet({ action: 'getPublicData', noCache: forceRefresh ? 'true' : '' });
    state.publicData = normalizePublicData(data);
    renderShiftCalendar();
    renderAdminPanel();
    showApiStatus('後端連線正常，已載入 8 月線上排班。資料時間：' + formatDateTime(data.generatedAt), 'success-text');
    return state.publicData;
  } catch (error) {
    showApiStatus('連線失敗：' + error.message, 'danger-text');
    renderMessage('#shiftList', error.message);
    renderMessage('#adminPanel', '請先確認 Apps Script 已部署，且存取權是「任何人」。');
    throw error;
  }
}

function normalizePublicData(data) {
  const normalized = { ...(data || {}) };
  normalized.shifts = (data && data.shifts ? data.shifts : []).map((shift) => ({
    ...shift,
    date: normalizeDateKey(shift.date)
  })).filter((shift) => Boolean(shift.date));
  normalized.sortedShifts = normalized.shifts.slice().sort(compareShift);
  normalized.shiftsByDate = groupBy(normalized.sortedShifts, (shift) => shift.date);
  normalized.shiftById = Object.create(null);
  normalized.sortedShifts.forEach((shift) => {
    if (shift.shiftId) normalized.shiftById[String(shift.shiftId)] = shift;
  });
  normalized.selections = (data && data.selections) || [];
  normalized.swaps = (data && data.swaps) || [];
  normalized.releases = (data && data.releases) || normalized.swaps.filter(isReleaseRequest);
  normalized.releaseByShiftId = Object.create(null);
  normalized.releases.forEach((row) => {
    if (String(row.status || 'open') === 'open' && row.originalShiftId) {
      normalized.releaseByShiftId[String(row.originalShiftId)] = row;
    }
  });
  normalized.teachers = (data && data.teachers) || [];
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
  if (state.publicData) scheduleRenderShiftCalendar();
}

function scheduleRenderShiftCalendar() {
  if (state.renderTimer) window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(() => {
    state.renderTimer = null;
    renderShiftCalendar();
  }, 180);
}

async function queryMySchedule(options = {}) {
  const refreshPublic = options.refreshPublic === true;
  const input = document.querySelector('#queryInput');
  const key = input ? input.value.trim() : '';
  if (!key) {
    state.teacherKey = '';
    state.teacherResult = null;
    renderMessage('#mySchedule', '請先輸入學號或姓名。');
    scheduleRenderShiftCalendar();
    return;
  }

  state.teacherKey = key;
  scheduleRenderShiftCalendar();
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

    if (refreshPublic) {
      await loadPublicData({ quiet: true, forceRefresh: true });
      renderMySchedule();
    } else {
      renderShiftCalendar();
    }
  } catch (error) {
    state.teacherResult = null;
    renderMessage('#mySchedule', error.message + '（可以先確認是否已按「從原表匯入學號姓名」。）');
    scheduleRenderShiftCalendar();
  }
}

async function selectShift(shiftId) {
  const key = state.teacherKey || getInputKey();
  if (!key) {
    alert('請先輸入學號或姓名，再選班。');
    return;
  }

  try {
    const result = await apiGet({ action: 'selectShift', teacherKey: key, shiftId });
    alert(result.message || '選班成功。');
    await queryMySchedule({ refreshPublic: true });
  } catch (error) {
    alert(error.message);
    await loadPublicData({ forceRefresh: true });
  }
}

async function confirmSelection(selectionId, shiftId) {
  const key = state.teacherKey || getInputKey();
  if (!key && !selectionId) {
    alert('請先輸入學號或姓名。');
    return;
  }
  try {
    const result = await apiGet({ action: 'confirmShift', teacherKey: key, selectionId, shiftId });
    alert(result.message || '已確認。');
    await queryMySchedule({ refreshPublic: true });
  } catch (error) {
    alert(error.message);
  }
}

async function releaseMyShift(shiftId) {
  const key = state.teacherKey || getInputKey();
  if (!key) {
    alert('請先輸入學號或姓名。');
    return;
  }
  const note = prompt('釋出原因／備註，可留空。例如：當天有事，請其他老師認領。', '') || '';
  if (!confirm(`確定要把 ${shiftId} 釋出給其他老師認領嗎？\n在別人認領前，這班仍算在你名下。`)) return;

  try {
    const result = await apiGet({ action: 'releaseShift', teacherKey: key, shiftId, note });
    alert(result.message || '已釋出，等待其他老師認領。');
    await queryMySchedule({ refreshPublic: true });
  } catch (error) {
    alert(error.message);
  }
}

async function cancelRelease(shiftId) {
  const key = state.teacherKey || getInputKey();
  if (!key) {
    alert('請先輸入學號或姓名。');
    return;
  }
  if (!confirm(`確定取消釋出 ${shiftId} 嗎？`)) return;

  try {
    const result = await apiGet({ action: 'cancelRelease', teacherKey: key, shiftId });
    alert(result.message || '已取消釋出。');
    await queryMySchedule({ refreshPublic: true });
  } catch (error) {
    alert(error.message);
  }
}

async function claimReleasedShift(shiftId) {
  const key = state.teacherKey || getInputKey();
  if (!key) {
    alert('請先輸入學號或姓名，再認領。');
    return;
  }
  if (!confirm(`確定要認領 ${shiftId} 嗎？\n認領後這班會轉到你的名下，並需要重新按「我知道了」。`)) return;

  try {
    const result = await apiGet({ action: 'claimReleasedShift', teacherKey: key, shiftId });
    alert(result.message || '認領成功。');
    await queryMySchedule({ refreshPublic: true });
  } catch (error) {
    alert(error.message);
  }
}

async function setupBackend() {
  showApiStatus('正在建立後端工作表...', 'hint');
  try {
    const data = await apiGet({ action: 'setup' });
    showApiStatus(data.message || '後端工作表已建立完成。', 'success-text');
    await loadPublicData({ forceRefresh: true });
  } catch (error) {
    showApiStatus('建立失敗：' + error.message, 'danger-text');
  }
}

async function importTeachers() {
  showApiStatus('正在從原始表掃描「學號／姓名」並匯入 Teachers...', 'hint');
  try {
    const data = await apiGet({ action: 'importTeachers' });
    showApiStatus(`匯入完成：新增 ${data.imported || 0} 位，目前共 ${data.totalTeachers || 0} 位。`, 'success-text');
    await loadPublicData({ forceRefresh: true });
  } catch (error) {
    showApiStatus('匯入失敗：' + error.message, 'danger-text');
  }
}

function renderMySchedule() {
  const target = document.querySelector('#mySchedule');
  const data = state.teacherResult;
  if (!target) return;

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

  target.innerHTML = selections.map((selection) => {
    const shift = selection.shift || findShift(selection.shiftId) || {};
    const date = normalizeDateKey(shift.date) || '';
    const title = getShiftTitle(shift);
    const time = getShiftTime(shift);
    const confirmed = String(selection.confirmed).toLowerCase() === 'true';
    const release = findRelease(selection.shiftId);
    const releaseOwner = release && String(release.teacherId) === String(teacher.teacherId);

    return `
      <div class="card">
        <div class="card-title-row">
          <div>
            <h3>${escapeHtml(formatDateLabel(date))} ${escapeHtml(title)}</h3>
            <p>${escapeHtml(time)}</p>
            <p class="hint">班別代碼：${escapeHtml(selection.shiftId || shift.shiftId || '')}</p>
          </div>
          <span class="badge ${confirmed ? 'ok' : 'warn'}">${confirmed ? '已確認' : '未確認'}</span>
        </div>
        ${releaseOwner ? `<div class="release-box compact">此班已釋出待認領。<span>${escapeHtml(release.note || '')}</span></div>` : ''}
        <div class="search-row" style="margin-top:10px;">
          <button type="button" class="secondary" onclick="confirmSelection('${escapeAttr(selection.selectionId || '')}', '${escapeAttr(selection.shiftId || shift.shiftId || '')}')">我知道了</button>
          ${releaseOwner
            ? `<button type="button" class="danger" onclick="cancelRelease('${escapeAttr(selection.shiftId || shift.shiftId || '')}')">取消釋出</button>`
            : `<button type="button" class="danger" onclick="releaseMyShift('${escapeAttr(selection.shiftId || shift.shiftId || '')}')">釋出此班</button>`}
        </div>
      </div>
    `;
  }).join('');
}

function renderShiftCalendar() {
  const target = document.querySelector('#shiftList');
  if (!target) return;
  const data = state.publicData;
  if (!data) {
    renderMessage('#shiftList', '尚未載入月曆。');
    return;
  }

  const shifts = data.sortedShifts || (data.shifts || []).slice().sort(compareShift);
  if (shifts.length === 0) {
    renderMessage('#shiftList', '目前沒有可顯示的班別。');
    return;
  }

  const monthInfo = getCalendarMonth(shifts);
  const grouped = data.shiftsByDate || groupBy(shifts, (shift) => shift.date);
  const firstDay = new Date(monthInfo.year, monthInfo.month - 1, 1);
  const daysInMonth = new Date(monthInfo.year, monthInfo.month, 0).getDate();
  const startWeekday = firstDay.getDay();
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const cells = [];

  for (let i = 0; i < startWeekday; i++) {
    cells.push('<div class="calendar-day empty-day"></div>');
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${monthInfo.year}/${String(monthInfo.month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
    const date = new Date(monthInfo.year, monthInfo.month - 1, day);
    const weekday = date.getDay();
    const dayShifts = grouped[dateKey] || [];
    const missingCount = dayShifts.reduce((sum, shift) => sum + Number(shift.remaining || 0), 0);
    const restDay = weekday === 2 && dayShifts.length === 0;
    const hasShifts = dayShifts.length > 0;
    const expanded = hasShifts && state.expandedDates.has(dateKey);
    const dayClass = hasShifts ? (expanded ? 'expanded-day' : 'collapsed-day') : '';
    const hintText = hasShifts ? (expanded ? '｜收合' : '｜點開') : '';
    const dateHeader = hasShifts
      ? `<button type="button" class="day-number day-toggle" onclick="toggleDate('${escapeAttr(dateKey)}')" aria-expanded="${expanded ? 'true' : 'false'}">
          <strong>${day}</strong>
          <span>週${weekdayNames[weekday]}${missingCount ? `｜缺 ${missingCount}` : ''}${hintText}</span>
        </button>`
      : `<div class="day-number"><strong>${day}</strong><span>週${weekdayNames[weekday]}</span></div>`;

    cells.push(`
      <div class="calendar-day ${restDay ? 'rest-day' : ''} ${dayClass}">
        ${dateHeader}
        ${restDay ? '<div class="rest-note">週二休園</div>' : hasShifts ? (expanded ? renderDayShifts(dayShifts) : renderDaySummary(dayShifts, dateKey)) : '<div class="empty">尚無開放班別</div>'}
      </div>
    `);
  }

  target.innerHTML = `
    <div class="month-toolbar">
      <div>
        <h3>${monthInfo.year} 年 ${monthInfo.month} 月</h3>
        <p class="hint">預設先折疊成日期摘要；點日期展開當天班別。黃色是釋出待認領，綠色是你已選。</p>
      </div>
      <div class="month-actions">
        <span class="badge">共 ${shifts.length} 個班別</span>
        <button type="button" class="mini-button" onclick="expandAllDates()">全部展開</button>
        <button type="button" class="mini-button" onclick="collapseAllDates()">全部收合</button>
      </div>
    </div>
    <div class="calendar-wrap">
      <div class="calendar-grid calendar-head">${weekdayNames.map((day) => `<div>${day}</div>`).join('')}</div>
      <div class="calendar-grid">${cells.join('')}</div>
    </div>
  `;
}

function renderDaySummary(dayShifts, dateKey) {
  const missingCount = dayShifts.reduce((sum, shift) => sum + Number(shift.remaining || 0), 0);
  const selectedCount = dayShifts.reduce((sum, shift) => sum + Number(shift.selectedCount || 0), 0);
  const aPointCount = dayShifts.filter(isAPointShift).length;
  const releaseCount = dayShifts.filter((shift) => Boolean(findRelease(shift.shiftId))).length;
  const myCount = dayShifts.filter(isShiftSelectedByCurrentTeacher).length;
  const chips = [
    `${dayShifts.length} 班`,
    `缺 ${missingCount}`,
    selectedCount ? `已選 ${selectedCount}` : '尚無人選',
    aPointCount ? `A點 ${aPointCount}` : '',
    releaseCount ? `釋出 ${releaseCount}` : '',
    myCount ? `你有 ${myCount} 班` : ''
  ].filter(Boolean);

  return `
    <div class="day-summary" role="button" tabindex="0" onclick="toggleDate('${escapeAttr(dateKey)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDate('${escapeAttr(dateKey)}');}">
      <div class="summary-line"><strong>${chips[0]}</strong><span>${chips[1] || ''}</span></div>
      <div class="summary-chips">${chips.slice(2).map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}</div>
      <div class="collapse-hint">點日期展開看班別</div>
    </div>
  `;
}

function renderDayShifts(dayShifts) {
  if (!dayShifts || dayShifts.length === 0) {
    return '<div class="empty">尚無開放班別</div>';
  }

  return `<div class="shift-stack">${dayShifts.map(renderShiftPill).join('')}</div>`;
}

function renderShiftPill(shift) {
  const release = findRelease(shift.shiftId);
  const selected = isShiftSelectedByCurrentTeacher(shift);
  const full = Number(shift.remaining || 0) <= 0;
  const aPoint = isAPointShift(shift);
  const title = getShiftTitle(shift);
  const peopleText = getPeopleText(shift);
  const canSelect = !selected && !full && !release;
  const canClaim = release && !isReleaseOwnedByCurrentTeacher(release);
  const releaseOwner = release && isReleaseOwnedByCurrentTeacher(release);

  return `
    <div class="shift-pill ${aPoint ? 'a-point' : ''} ${full ? 'full' : ''} ${selected ? 'selected' : ''} ${release ? 'released' : ''}">
      <div class="shift-pill-main">
        <strong>${escapeHtml(title)}</strong>
        <span class="shift-code">${escapeHtml(shift.shiftId || '')}</span>
      </div>
      <div class="shift-time">${escapeHtml(getShiftTime(shift))}</div>
      <div class="shift-people">${escapeHtml(peopleText)}</div>
      ${release ? `<div class="release-box">釋出中：${escapeHtml(release.teacherName || '')}<br><span>${escapeHtml(release.note || '')}</span></div>` : ''}
      <div class="shift-action-row">
        <span class="mini-badge">${selected ? '你已選' : full ? '額滿' : release ? '可認領' : `缺 ${Number(shift.remaining || 0)}`}</span>
        ${canSelect ? `<button type="button" class="mini-button" onclick="selectShift('${escapeAttr(shift.shiftId || '')}')">選班</button>` : ''}
        ${canClaim ? `<button type="button" class="mini-button claim-button" onclick="claimReleasedShift('${escapeAttr(shift.shiftId || '')}')">認領</button>` : ''}
        ${releaseOwner ? `<button type="button" class="mini-button danger" onclick="cancelRelease('${escapeAttr(shift.shiftId || '')}')">取消</button>` : ''}
      </div>
    </div>
  `;
}

function renderAdminPanel() {
  const target = document.querySelector('#adminPanel');
  if (!target) return;
  const data = state.publicData;
  if (!data) {
    renderMessage('#adminPanel', '尚未載入公開檢查資料。');
    return;
  }

  const selections = data.selections || [];
  const releases = data.releases || [];
  const unconfirmed = selections.filter((row) => String(row.confirmed).toLowerCase() !== 'true');

  target.innerHTML = `
    <h3>已選班紀錄</h3>
    ${renderSelectionTable(selections)}
    <h3 style="margin-top:16px;">未確認提醒</h3>
    ${renderSelectionTable(unconfirmed)}
    <h3 style="margin-top:16px;">釋出／認領公開區</h3>
    ${renderReleaseTable(releases)}
  `;
}

function renderSelectionTable(rows) {
  if (!rows || rows.length === 0) return '<div class="empty">目前沒有資料。</div>';
  return `
    <table>
      <thead><tr><th>老師</th><th>班別</th><th>狀態</th><th>時間</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.teacherId || '')}<br>${escapeHtml(row.teacherName || '')}</td>
            <td>${escapeHtml(row.shiftId || '')}</td>
            <td>${String(row.confirmed).toLowerCase() === 'true' ? '已確認' : '未確認'}</td>
            <td>${escapeHtml(row.selectedAt || '')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderReleaseTable(rows) {
  if (!rows || rows.length === 0) return '<div class="empty">目前沒有釋出待認領班別。</div>';
  return `
    <table>
      <thead><tr><th>釋出老師</th><th>班別</th><th>備註</th><th>狀態</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.teacherId || '')}<br>${escapeHtml(row.teacherName || '')}</td>
            <td>${escapeHtml(row.originalShiftId || '')}</td>
            <td>${escapeHtml(row.note || '')}</td>
            <td>${escapeHtml(row.status || 'open')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function toggleDate(dateKey) {
  if (!dateKey) return;
  if (state.expandedDates.has(dateKey)) {
    state.expandedDates.delete(dateKey);
  } else {
    state.expandedDates.add(dateKey);
  }
  renderShiftCalendar();
}

function expandAllDates() {
  if (!state.publicData || !state.publicData.shifts) return;
  state.publicData.shifts.forEach((shift) => {
    if (shift.date) state.expandedDates.add(shift.date);
  });
  renderShiftCalendar();
}

function collapseAllDates() {
  state.expandedDates.clear();
  renderShiftCalendar();
}

function getInputKey() {
  const input = document.querySelector('#queryInput');
  return input ? input.value.trim() : '';
}

function renderMessage(selector, message) {
  const target = document.querySelector(selector);
  if (!target) return;
  target.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
}

function findShift(shiftId) {
  const data = state.publicData;
  if (!data) return null;
  if (data.shiftById && data.shiftById[String(shiftId)]) return data.shiftById[String(shiftId)];
  const shifts = data.shifts || [];
  return shifts.find((shift) => String(shift.shiftId) === String(shiftId)) || null;
}

function findRelease(shiftId) {
  const data = state.publicData;
  if (!data) return null;
  if (data.releaseByShiftId && data.releaseByShiftId[String(shiftId)]) return data.releaseByShiftId[String(shiftId)];
  const releases = data.releases || [];
  return releases.find((row) => String(row.originalShiftId) === String(shiftId) && String(row.status || 'open') === 'open') || null;
}

function isReleaseRequest(row) {
  return String(row.desiredShiftId || '') === 'RELEASE' || String(row.requestId || '').startsWith('REL-');
}

function isReleaseOwnedByCurrentTeacher(release) {
  const teacher = state.teacherResult && state.teacherResult.teacher;
  const key = state.teacherKey || getInputKey();
  return Boolean(release && (
    (teacher && String(release.teacherId) === String(teacher.teacherId)) ||
    String(release.teacherId) === String(key) ||
    normalizeText(release.teacherName) === normalizeText(key)
  ));
}

function isShiftSelectedByCurrentTeacher(shift) {
  const teacher = state.teacherResult && state.teacherResult.teacher;
  const key = state.teacherKey || getInputKey();
  const people = shift.selectedPeople || [];
  return people.some((person) => {
    return (teacher && String(person.teacherId) === String(teacher.teacherId)) ||
      String(person.teacherId) === String(key) ||
      normalizeText(person.teacherName) === normalizeText(key);
  });
}

function getPeopleText(shift) {
  const people = shift.selectedPeople || [];
  const names = people.map((person) => {
    const mark = String(person.confirmed).toLowerCase() === 'true' ? '✓' : '未確認';
    return `${person.teacherName || person.teacherId || '未命名'}(${mark})`;
  });
  const remaining = Number(shift.remaining || 0);
  return names.length ? names.join('、') + `｜剩 ${remaining}` : `尚無人選｜剩 ${remaining}`;
}

function getShiftTitle(shift) {
  return shift.duty || shift.site || shift.shiftId || '未命名班別';
}

function getShiftTime(shift) {
  const site = shift.site ? `${shift.site}｜` : '';
  const start = shift.startTime || '';
  const end = shift.endTime || '';
  const report = shift.reportTime ? `，報到 ${shift.reportTime}` : '';
  if (start || end) return `${site}${start}${end ? '－' + end : ''}${report}`;
  return site ? site.replace('｜', '') : '未設定時間';
}

function isAPointShift(shift) {
  const text = `${shift.site || ''} ${shift.duty || ''}`;
  return /A點|A点|A哨|A\s*point/i.test(text);
}

function compareShift(a, b) {
  const dateA = normalizeDateKey(a.date);
  const dateB = normalizeDateKey(b.date);
  if (dateA !== dateB) return dateA.localeCompare(dateB);
  return String(a.startTime || '').localeCompare(String(b.startTime || '')) || String(a.shiftId || '').localeCompare(String(b.shiftId || ''));
}

function getCalendarMonth(shifts) {
  const counts = {};
  shifts.forEach((shift) => {
    const date = normalizeDateKey(shift.date);
    const matched = date.match(/^(\d{4})\/(\d{2})\//);
    if (!matched) return;
    const key = `${matched[1]}/${matched[2]}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  const chosen = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (chosen) {
    const [year, month] = chosen[0].split('/').map(Number);
    return { year, month };
  }
  return { year: 2026, month: 8 };
}

function formatDateLabel(dateKey) {
  const date = normalizeDateKey(dateKey);
  if (!date) return '';
  const [year, month, day] = date.split('/').map(Number);
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(year, month - 1, day).getDay()];
  return `${month}/${day}（${weekday}）`;
}

function formatDateTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-TW', { hour12: false });
}

function groupBy(rows, keyOrFn) {
  return (rows || []).reduce((acc, row) => {
    const key = typeof keyOrFn === 'function' ? keyOrFn(row) : row[keyOrFn];
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim();
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function injectCollapseStyles() {
  if (document.querySelector('#collapseCalendarStyles')) return;
  const style = document.createElement('style');
  style.id = 'collapseCalendarStyles';
  style.textContent = `
    .month-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
    }
    .month-actions .mini-button {
      background: #475569;
      color: #fff;
    }
    button.day-number.day-toggle {
      width: 100%;
      border: 1px solid #bae6fd;
      background: #e0f2fe;
      color: #0f172a;
      text-align: left;
    }
    button.day-number.day-toggle:hover { filter: brightness(0.98); }
    .calendar-day.collapsed-day {
      min-height: 150px;
    }
    .day-summary {
      display: grid;
      gap: 7px;
      padding: 9px;
      border: 1px dashed #94a3b8;
      border-radius: 10px;
      background: #f8fafc;
      cursor: pointer;
    }
    .day-summary:focus {
      outline: 3px solid #bfdbfe;
      outline-offset: 2px;
    }
    .summary-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      font-weight: 900;
      color: #0f172a;
    }
    .summary-line span { color: #b91c1c; }
    .summary-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .summary-chips span {
      display: inline-flex;
      border-radius: 999px;
      padding: 2px 7px;
      background: #e5e7eb;
      color: #334155;
      font-size: 11px;
      font-weight: 800;
    }
    .collapse-hint {
      color: #64748b;
      font-size: 12px;
      font-weight: 700;
    }
    @media (max-width: 720px) {
      .month-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 5px;
      }
      .month-actions .badge { grid-column: 1 / -1; justify-content: center; }
      .month-actions .mini-button { width: 100%; min-height: 32px; font-size: 12px; }
      button.day-number.day-toggle { min-height: 0; padding: 3px; }
      .calendar-day.collapsed-day { min-height: 86px; }
      .day-summary { gap: 3px; padding: 4px; border-radius: 7px; }
      .summary-line { display: grid; gap: 1px; font-size: 10px; }
      .summary-chips { gap: 2px; }
      .summary-chips span { padding: 1px 4px; font-size: 8.5px; }
      .collapse-hint { font-size: 8.5px; }
    }
  `;
  document.head.appendChild(style);
}

window.addEventListener('DOMContentLoaded', () => {
  injectCollapseStyles();

  const refreshBtn = document.querySelector('#refreshBtn');
  const setupBtn = document.querySelector('#setupBackendBtn');
  const importBtn = document.querySelector('#importTeachersBtn');
  const searchBtn = document.querySelector('#searchBtn');
  const input = document.querySelector('#queryInput');

  if (refreshBtn) refreshBtn.addEventListener('click', () => loadPublicData({ forceRefresh: true }));
  if (setupBtn) setupBtn.addEventListener('click', setupBackend);
  if (importBtn) importBtn.addEventListener('click', importTeachers);
  if (searchBtn) searchBtn.addEventListener('click', () => queryMySchedule());
  if (input) {
    input.addEventListener('input', useTypedTeacherKey);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') queryMySchedule();
    });
  }

  loadPublicData();
});
