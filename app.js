const API_URL_STORAGE_KEY = 'volunteerShiftSystemApiUrl';

let currentTeacher = null;
let latestData = null;

function getApiUrl() {
  return localStorage.getItem(API_URL_STORAGE_KEY) || '';
}

function setApiUrl(url) {
  localStorage.setItem(API_URL_STORAGE_KEY, url.trim());
}

function showApiStatus(message, type = 'hint') {
  const el = document.querySelector('#apiStatus');
  el.className = type;
  el.textContent = message;
}

function requireApiUrl() {
  const apiUrl = getApiUrl();
  if (!apiUrl) {
    throw new Error('請先貼上並儲存 Apps Script Web App URL。');
  }
  return apiUrl;
}

async function apiGet(params) {
  const apiUrl = requireApiUrl();
  const url = new URL(apiUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  const response = await fetch(url.toString(), { method: 'GET' });
  const data = await response.json();
  if (!data.ok) throw new Error(data.error || '後端回傳錯誤。');
  return data;
}

async function saveApiUrlAndTest() {
  const input = document.querySelector('#apiUrlInput');
  const url = input.value.trim();

  if (!url) {
    showApiStatus('請先貼上 Apps Script Web App URL。', 'danger-text');
    return;
  }

  setApiUrl(url);
  showApiStatus('已儲存，正在測試連線...', 'hint');

  try {
    const data = await apiGet({ action: 'status' });
    showApiStatus(data.message || '後端連線正常。', 'success-text');
  } catch (error) {
    showApiStatus('連線失敗：' + error.message, 'danger-text');
  }
}

async function queryMySchedule() {
  const input = document.querySelector('#queryInput');
  const code = input.value.trim();

  if (!code) {
    renderMessage('#mySchedule', '請先輸入個人代碼。');
    return;
  }

  renderMessage('#mySchedule', '查詢中...');
  renderMessage('#shiftList', '載入可選班別中...');

  try {
    const data = await apiGet({ action: 'query', q: code });
    currentTeacher = data.teacher;
    latestData = data;
    renderMySchedule(data);
    renderShiftList(data);
  } catch (error) {
    currentTeacher = null;
    latestData = null;
    renderMessage('#mySchedule', error.message);
    renderMessage('#shiftList', '查詢成功後才會顯示可選班別。');
  }
}

async function selectShift(shiftId) {
  if (!currentTeacher) {
    alert('請先輸入個人代碼查詢。');
    return;
  }

  try {
    const data = await apiGet({
      action: 'select',
      teacher_id: currentTeacher.teacher_id,
      shift_id: shiftId
    });
    latestData = data;
    renderMySchedule(data);
    renderShiftList(data);
    alert(data.message || '選班成功。');
  } catch (error) {
    alert(error.message);
    queryMySchedule();
  }
}

async function confirmSelection(selectionId) {
  if (!currentTeacher) {
    alert('請先輸入個人代碼查詢。');
    return;
  }

  try {
    const data = await apiGet({
      action: 'confirm',
      teacher_id: currentTeacher.teacher_id,
      selection_id: selectionId
    });
    latestData = {
      ...latestData,
      selections: data.selections,
      availableShifts: data.availableShifts
    };
    renderMySchedule(latestData);
    renderShiftList(latestData);
  } catch (error) {
    alert(error.message);
  }
}

async function adminReport() {
  const token = document.querySelector('#adminTokenInput').value.trim();
  if (!token) {
    renderMessage('#adminPanel', '請先輸入管理員 token。');
    return;
  }

  renderMessage('#adminPanel', '載入管理員名單中...');

  try {
    const data = await apiGet({ action: 'admin', token });
    renderAdminPanel(data.selections || []);
  } catch (error) {
    renderMessage('#adminPanel', error.message);
  }
}

async function setupBackend() {
  const token = document.querySelector('#adminTokenInput').value.trim();
  if (!token) {
    renderMessage('#adminPanel', '請先輸入管理員 token。');
    return;
  }

  renderMessage('#adminPanel', '建立後端工作表中...');

  try {
    const data = await apiGet({ action: 'setup', token });
    renderMessage('#adminPanel', data.message || '後端工作表已建立完成。');
  } catch (error) {
    renderMessage('#adminPanel', error.message);
  }
}

async function importTeachers() {
  const token = document.querySelector('#adminTokenInput').value.trim();
  if (!token) {
    renderMessage('#adminPanel', '請先輸入管理員 token。');
    return;
  }

  renderMessage('#adminPanel', '正在從原表掃描「學號／姓名」並匯入 Teachers...');

  try {
    const data = await apiGet({ action: 'importTeachers', token });
    renderMessage('#adminPanel', data.message || '匯入完成。');
  } catch (error) {
    renderMessage('#adminPanel', error.message);
  }
}

function renderMySchedule(data) {
  const target = document.querySelector('#mySchedule');
  const teacher = data.teacher;
  const selections = data.selections || [];

  if (selections.length === 0) {
    target.innerHTML = `
      <div class="empty">
        ${escapeHtml(teacher.display_name)} 目前尚未選班。
      </div>
    `;
    return;
  }

  target.innerHTML = selections.map((item) => {
    const statusClass = item.confirmed ? 'ok' : 'warn';
    const statusText = item.confirmed ? '已確認收到提醒' : '尚未確認';
    return `
      <article class="card">
        <div class="card-title-row">
          <h3>${escapeHtml(item.date)}｜${escapeHtml(item.duty)}</h3>
          <span class="badge ${statusClass}">${statusText}</span>
        </div>
        <p><strong>服務時間：</strong>${escapeHtml(item.time)}</p>
        <p><strong>報到時間：</strong>${escapeHtml(item.report_time)}</p>
        <p><strong>地點：</strong>${escapeHtml(item.place)}</p>
        ${item.confirmed
          ? `<p class="hint">確認時間：${escapeHtml(formatDateTime(item.confirmed_at))}</p>`
          : `<button class="secondary" type="button" onclick="confirmSelection('${escapeAttr(item.selection_id)}')">我知道了</button>`}
      </article>
    `;
  }).join('');
}

function renderShiftList(data) {
  const target = document.querySelector('#shiftList');
  const selectedShiftIds = new Set((data.selections || []).map(item => item.shift_id));
  const shifts = data.availableShifts || [];

  if (shifts.length === 0) {
    target.innerHTML = '<div class="empty">目前沒有可選班別。</div>';
    return;
  }

  target.innerHTML = shifts.map((shift) => {
    const full = Number(shift.remaining) <= 0;
    const alreadySelected = selectedShiftIds.has(shift.shift_id);
    const disabled = full || alreadySelected;
    const badgeClass = full ? 'danger' : 'ok';
    const badgeText = full ? '已額滿' : `剩 ${shift.remaining} 名`;
    const buttonText = alreadySelected ? '你已選此班' : full ? '已額滿' : '選這一班';

    return `
      <article class="card">
        <div class="card-title-row">
          <h3>${escapeHtml(shift.date)}｜${escapeHtml(shift.duty)}</h3>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <p><strong>服務時間：</strong>${escapeHtml(shift.time)}</p>
        <p><strong>報到時間：</strong>${escapeHtml(shift.report_time)}</p>
        <p><strong>地點：</strong>${escapeHtml(shift.place)}</p>
        <p><strong>名額：</strong>${shift.selected_count} / ${shift.quota}</p>
        <button type="button" ${disabled ? 'disabled' : ''} onclick="selectShift('${escapeAttr(shift.shift_id)}')">${buttonText}</button>
      </article>
    `;
  }).join('');
}

function renderAdminPanel(selections) {
  const panel = document.querySelector('#adminPanel');

  if (selections.length === 0) {
    panel.innerHTML = '<div class="empty">目前沒有任何選班紀錄。</div>';
    return;
  }

  const rows = selections.map(item => {
    const statusClass = item.confirmed ? 'ok' : 'warn';
    const statusText = item.confirmed ? '已確認' : '未確認';
    return `
      <tr>
        <td>${escapeHtml(item.display_name)}<br><span class="hint">${escapeHtml(item.teacher_id)}</span></td>
        <td>${escapeHtml(item.date)}<br>${escapeHtml(item.duty)}</td>
        <td>${escapeHtml(item.time)}<br>${escapeHtml(item.place)}</td>
        <td><span class="badge ${statusClass}">${statusText}</span></td>
      </tr>
    `;
  }).join('');

  panel.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>人員</th>
          <th>班別</th>
          <th>時間／地點</th>
          <th>確認狀態</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderMessage(selector, message) {
  document.querySelector(selector).innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
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
  const savedApiUrl = getApiUrl();
  document.querySelector('#apiUrlInput').value = savedApiUrl;

  if (savedApiUrl) {
    showApiStatus('已載入本機儲存的後端網址。', 'success-text');
  } else {
    showApiStatus('尚未設定 Apps Script Web App URL。', 'danger-text');
  }

  renderMessage('#mySchedule', '請輸入個人代碼查詢。');
  renderMessage('#shiftList', '查詢成功後才會顯示可選班別。');
  renderMessage('#adminPanel', '管理員輸入 token 後可查看全部選班紀錄。');
}

document.querySelector('#saveApiUrlBtn').addEventListener('click', saveApiUrlAndTest);
document.querySelector('#searchBtn').addEventListener('click', queryMySchedule);
document.querySelector('#queryInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') queryMySchedule();
});
document.querySelector('#adminBtn').addEventListener('click', adminReport);
document.querySelector('#setupBackendBtn').addEventListener('click', setupBackend);
document.querySelector('#importTeachersBtn').addEventListener('click', importTeachers);

init();
