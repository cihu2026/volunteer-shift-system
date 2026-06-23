(function () {
  function getMissingCount(text) {
    const matched = String(text || '').match(/缺\s*(\d+)/);
    return matched ? Number(matched[1]) : 0;
  }

  function getStatusClassByMissing(missing, hasShifts, isRest) {
    if (isRest) return 'status-rest';
    if (!hasShifts) return '';
    if (missing <= 0) return 'status-full';
    if (missing === 1) return 'status-almost';
    return 'status-short';
  }

  function compactDayButton(day, statusClass, missing, isRest) {
    const button = day.querySelector('.day-number');
    if (!button || button.dataset.compacted === '1') return;

    const strong = button.querySelector('strong');
    const span = button.querySelector('span');
    if (!strong || !span) return;

    const weekMatch = span.textContent.match(/週[日一二三四五六]/);
    const weekText = weekMatch ? weekMatch[0] : span.textContent.trim().slice(0, 2);
    const chipText = isRest ? '休園' : missing <= 0 ? '已滿' : `缺${missing}`;

    span.classList.add('weekday-text');
    span.textContent = weekText;

    const chip = document.createElement('em');
    chip.className = 'status-chip';
    chip.textContent = chipText;
    button.appendChild(chip);
    button.dataset.compacted = '1';
  }

  function applyCalendarStatusColors() {
    document.querySelectorAll('.calendar-day').forEach((day) => {
      day.classList.remove('status-full', 'status-almost', 'status-short', 'status-rest');
      const text = day.textContent || '';
      const isRest = day.classList.contains('rest-day') || text.includes('週二休園') || text.includes('休園');
      const hasShifts = day.classList.contains('collapsed-day') || day.classList.contains('expanded-day') || day.querySelector('.shift-pill');
      const missing = getMissingCount(text);
      const statusClass = getStatusClassByMissing(missing, hasShifts, isRest);
      if (statusClass) day.classList.add(statusClass);
      compactDayButton(day, statusClass, missing, isRest);
    });

    document.querySelectorAll('.shift-pill').forEach((pill) => {
      pill.classList.remove('status-full', 'status-almost', 'status-short');
      const text = pill.textContent || '';
      const missing = getMissingCount(text);
      if (pill.classList.contains('full') || text.includes('額滿')) {
        pill.classList.add('status-full');
      } else if (missing === 1) {
        pill.classList.add('status-almost');
      } else if (missing > 1) {
        pill.classList.add('status-short');
      }
    });
  }

  const hook = () => {
    if (typeof window.renderShiftCalendar !== 'function' || window.__statusColorPatchApplied) return;
    const original = window.renderShiftCalendar;
    window.renderShiftCalendar = function (...args) {
      const result = original.apply(this, args);
      window.requestAnimationFrame(applyCalendarStatusColors);
      return result;
    };
    window.__statusColorPatchApplied = true;
  };

  hook();
  document.addEventListener('DOMContentLoaded', () => {
    hook();
    setTimeout(applyCalendarStatusColors, 300);
    setTimeout(applyCalendarStatusColors, 1000);
  });
})();
