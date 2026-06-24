// v52：7欄月曆穩定版。格內不顯示週幾；點日期後展開一列一列班別。
(function () {
  const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

  function mondayIndex(jsDay) {
    return (jsDay + 6) % 7;
  }

  function getMissingCount(dayShifts) {
    return (dayShifts || []).reduce((sum, shift) => sum + Number(shift.remaining || 0), 0);
  }

  function getDayStatusText(dayShifts, restDay) {
    if (restDay) return '休';
    const missing = getMissingCount(dayShifts);
    if (missing <= 0) return '已滿';
    return `缺${missing}`;
  }

  function getDayStatusClass(dayShifts, restDay) {
    if (restDay) return 'status-rest';
    if ((dayShifts || []).some(isShiftSelectedByCurrentTeacher)) return 'status-mine';
    const missing = getMissingCount(dayShifts);
    if (missing <= 0) return 'status-full';
    if (missing === 1) return 'status-almost';
    return 'status-short';
  }

  function getShiftStatusClass(shift) {
    if (isShiftSelectedByCurrentTeacher(shift)) return 'status-mine selected';
    if (findRelease(shift.shiftId)) return 'released';
    const missing = Number(shift.remaining || 0);
    if (missing <= 0) return 'status-full full';
    if (missing === 1) return 'status-almost';
    return 'status-short';
  }

  window.renderDaySummary = function renderDaySummary(dayShifts, dateKey) {
    return '';
  };

  window.renderShiftCalendar = function renderShiftCalendar() {
    const target = document.querySelector('#shiftList');
    if (!target) return;
    const data = state.publicData;
    if (!data) {
      renderMessage('#shiftList', '尚未載入月曆。');
      return;
    }

    const shifts = (data.shifts || []).slice().sort(compareShift);
    if (shifts.length === 0) {
      renderMessage('#shiftList', '目前沒有可顯示的班別。');
      return;
    }

    const monthInfo = getCalendarMonth(shifts);
    const grouped = groupBy(shifts, (shift) => shift.date);
    const firstDay = new Date(monthInfo.year, monthInfo.month - 1, 1);
    const daysInMonth = new Date(monthInfo.year, monthInfo.month, 0).getDate();
    const startOffset = mondayIndex(firstDay.getDay());
    const cells = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push('<div class="calendar-day empty-day" aria-hidden="true"></div>');
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateKey = `${monthInfo.year}/${String(monthInfo.month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
      const date = new Date(monthInfo.year, monthInfo.month - 1, day);
      const isTuesday = date.getDay() === 2;
      const dayShifts = grouped[dateKey] || [];
      const restDay = isTuesday && dayShifts.length === 0;
      const hasShifts = dayShifts.length > 0;
      const expanded = hasShifts && state.expandedDates.has(dateKey);
      const statusText = hasShifts || restDay ? getDayStatusText(dayShifts, restDay) : '—';
      const statusClass = hasShifts || restDay ? getDayStatusClass(dayShifts, restDay) : 'status-empty';
      const dayClass = hasShifts ? (expanded ? 'expanded-day' : 'collapsed-day') : '';
      const content = restDay
        ? ''
        : hasShifts
          ? (expanded ? renderDayShifts(dayShifts) : '')
          : '';
      const header = hasShifts
        ? `<button type="button" class="day-number day-toggle" onclick="toggleDate('${escapeAttr(dateKey)}')" aria-expanded="${expanded ? 'true' : 'false'}" aria-label="${monthInfo.month}月${day}日 ${statusText}">
            <strong>${day}</strong><span>${escapeHtml(statusText)}</span>
          </button>`
        : `<div class="day-number"><strong>${day}</strong><span>${escapeHtml(statusText)}</span></div>`;

      cells.push(`
        <div class="calendar-day ${statusClass} ${restDay ? 'rest-day' : ''} ${dayClass}">
          ${header}
          ${content}
        </div>
      `);
    }

    target.innerHTML = `
      <div class="month-toolbar compact-toolbar">
        <div>
          <h3>${monthInfo.year} 年 ${monthInfo.month} 月</h3>
          <p class="hint">先看日期缺額；點日期展開當天一列一列班別。</p>
        </div>
        <div class="month-actions compact-actions">
          <span class="badge">共 ${shifts.length} 個班別</span>
        </div>
      </div>
      <div class="calendar-wrap compact-calendar-wrap">
        <div class="calendar-grid calendar-head">${WEEKDAY_LABELS.map((day) => `<div>${day}</div>`).join('')}</div>
        <div class="calendar-grid compact-calendar-grid">${cells.join('')}</div>
      </div>
    `;
  };

  window.renderShiftPill = function renderShiftPill(shift) {
    const release = findRelease(shift.shiftId);
    const selected = isShiftSelectedByCurrentTeacher(shift);
    const full = Number(shift.remaining || 0) <= 0;
    const aPoint = isAPointShift(shift);
    const title = getShiftTitle(shift);
    const peopleText = getPeopleText(shift);
    const canSelect = !selected && !full && !release;
    const canClaim = release && !isReleaseOwnedByCurrentTeacher(release);
    const releaseOwner = release && isReleaseOwnedByCurrentTeacher(release);
    const statusClass = getShiftStatusClass(shift);

    return `
      <div class="shift-pill ${statusClass} ${aPoint ? 'a-point' : ''}">
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
  };
})();
