const teachers = [
  { id: "T001", name: "王老師", order: 1 },
  { id: "T002", name: "陳老師", order: 2 },
  { id: "T003", name: "林老師", order: 3 }
];

const shifts = [
  {
    id: "S001",
    date: "2026/07/05（日）",
    duty: "A哨上午班",
    time: "09:00－12:00",
    reportTime: "08:50",
    place: "A哨",
    quota: 1
  },
  {
    id: "S002",
    date: "2026/07/05（日）",
    duty: "A哨下午班",
    time: "12:00－13:30",
    reportTime: "11:50",
    place: "A哨",
    quota: 1
  },
  {
    id: "S003",
    date: "2026/07/06（一）",
    duty: "導覽第 1 梯",
    time: "09:00－09:30",
    reportTime: "08:50",
    place: "導覽集合處",
    quota: 2
  },
  {
    id: "S004",
    date: "2026/07/06（一）",
    duty: "導覽第 3 梯",
    time: "10:00－10:30",
    reportTime: "09:50",
    place: "導覽集合處",
    quota: 2
  },
  {
    id: "S005",
    date: "2026/07/07（二）",
    duty: "留守支援",
    time: "09:00－12:00",
    reportTime: "08:50",
    place: "遊客中心",
    quota: 1
  }
];

const STORAGE_KEY = "volunteerShiftSystemSelections";

function getSelections() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (error) {
    return [];
  }
}

function saveSelections(selections) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
}

function findTeacher(keyword) {
  const value = keyword.trim();
  return teachers.find((teacher) => teacher.id === value || teacher.name === value);
}

function getCurrentTeacher() {
  const input = document.querySelector("#queryInput");
  if (!input) return null;
  return findTeacher(input.value);
}

function getShiftById(shiftId) {
  return shifts.find((shift) => shift.id === shiftId);
}

function countSelected(shiftId) {
  return getSelections().filter((selection) => selection.shiftId === shiftId).length;
}

function hasSelected(teacherId, shiftId) {
  return getSelections().some(
    (selection) => selection.teacherId === teacherId && selection.shiftId === shiftId
  );
}

function getTeacherSelections(teacherId) {
  return getSelections().filter((selection) => selection.teacherId === teacherId);
}

function selectShift(teacherId, shiftId) {
  const teacher = teachers.find((item) => item.id === teacherId);
  const shift = getShiftById(shiftId);

  if (!teacher || !shift) {
    alert("查無人員或班別，請重新確認。");
    return;
  }

  if (hasSelected(teacherId, shiftId)) {
    alert("你已經選過這一班了。");
    return;
  }

  if (countSelected(shiftId) >= shift.quota) {
    alert("這個班別已額滿。");
    return;
  }

  const selections = getSelections();
  selections.push({
    id: `${teacherId}-${shiftId}`,
    teacherId,
    teacherName: teacher.name,
    shiftId,
    confirmed: false,
    selectedAt: new Date().toISOString(),
    confirmedAt: ""
  });
  saveSelections(selections);
  renderAll();
  alert("選班成功。請到自己的班表按「我知道了」。");
}

function confirmShift(selectionId) {
  const selections = getSelections().map((selection) => {
    if (selection.id !== selectionId) return selection;
    return {
      ...selection,
      confirmed: true,
      confirmedAt: new Date().toISOString()
    };
  });
  saveSelections(selections);
  renderAll();
}

function renderMySchedule() {
  const result = document.querySelector("#mySchedule");
  const input = document.querySelector("#queryInput");
  const keyword = input.value.trim();

  if (!keyword) {
    result.innerHTML = `<div class="empty">請先輸入姓名或代碼。</div>`;
    return;
  }

  const teacher = findTeacher(keyword);
  if (!teacher) {
    result.innerHTML = `<div class="empty">查無此人，請確認姓名或代碼是否正確。</div>`;
    return;
  }

  const selections = getTeacherSelections(teacher.id);
  if (selections.length === 0) {
    result.innerHTML = `<div class="empty">${teacher.name} 目前尚未選班。</div>`;
    return;
  }

  result.innerHTML = selections
    .map((selection) => {
      const shift = getShiftById(selection.shiftId);
      const statusClass = selection.confirmed ? "ok" : "warn";
      const statusText = selection.confirmed ? "已確認收到提醒" : "尚未確認";
      return `
        <article class="card">
          <div class="card-title-row">
            <h3>${shift.date}｜${shift.duty}</h3>
            <span class="badge ${statusClass}">${statusText}</span>
          </div>
          <p><strong>服務時間：</strong>${shift.time}</p>
          <p><strong>報到時間：</strong>${shift.reportTime}</p>
          <p><strong>地點：</strong>${shift.place}</p>
          ${
            selection.confirmed
              ? `<p class="hint">確認時間：${formatDateTime(selection.confirmedAt)}</p>`
              : `<button class="secondary" type="button" onclick="confirmShift('${selection.id}')">我知道了</button>`
          }
        </article>
      `;
    })
    .join("");
}

function renderShiftList() {
  const currentTeacher = getCurrentTeacher();
  const list = document.querySelector("#shiftList");

  list.innerHTML = shifts
    .map((shift) => {
      const selectedCount = countSelected(shift.id);
      const remaining = Math.max(shift.quota - selectedCount, 0);
      const full = remaining <= 0;
      const alreadySelected = currentTeacher && hasSelected(currentTeacher.id, shift.id);
      const canSelect = currentTeacher && !full && !alreadySelected;
      const badgeClass = full ? "danger" : "ok";
      const badgeText = full ? "已額滿" : `剩 ${remaining} 名`;

      return `
        <article class="card">
          <div class="card-title-row">
            <h3>${shift.date}｜${shift.duty}</h3>
            <span class="badge ${badgeClass}">${badgeText}</span>
          </div>
          <p><strong>服務時間：</strong>${shift.time}</p>
          <p><strong>報到時間：</strong>${shift.reportTime}</p>
          <p><strong>地點：</strong>${shift.place}</p>
          <p><strong>名額：</strong>${selectedCount} / ${shift.quota}</p>
          <button type="button" ${canSelect ? "" : "disabled"} onclick="selectShift('${currentTeacher ? currentTeacher.id : ""}', '${shift.id}')">
            ${alreadySelected ? "你已選此班" : full ? "已額滿" : currentTeacher ? "選這一班" : "請先輸入姓名或代碼"}
          </button>
        </article>
      `;
    })
    .join("");
}

function renderAdminPanel() {
  const panel = document.querySelector("#adminPanel");
  const selections = getSelections();

  if (selections.length === 0) {
    panel.innerHTML = `<div class="empty">目前沒有任何選班紀錄。</div>`;
    return;
  }

  const rows = selections
    .map((selection) => {
      const shift = getShiftById(selection.shiftId);
      const status = selection.confirmed ? "已確認" : "未確認";
      const statusClass = selection.confirmed ? "ok" : "warn";
      return `
        <tr>
          <td>${selection.teacherName}<br><span class="hint">${selection.teacherId}</span></td>
          <td>${shift.date}<br>${shift.duty}</td>
          <td>${shift.time}<br>${shift.place}</td>
          <td><span class="badge ${statusClass}">${status}</span></td>
        </tr>
      `;
    })
    .join("");

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

function renderAll() {
  renderMySchedule();
  renderShiftList();
  renderAdminPanel();
}

function resetDemo() {
  if (!confirm("確定要清除這台裝置上的示範選班與確認紀錄嗎？")) return;
  localStorage.removeItem(STORAGE_KEY);
  renderAll();
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

document.querySelector("#searchBtn").addEventListener("click", renderAll);
document.querySelector("#queryInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") renderAll();
});
document.querySelector("#queryInput").addEventListener("input", renderShiftList);
document.querySelector("#resetBtn").addEventListener("click", resetDemo);

renderAll();
