export const CALENDAR_RUNTIME_JS = String.raw`(() => {
  const button = document.querySelector('[data-blog-calendar-toggle]');
  const panel = document.querySelector('[data-blog-calendar-panel]');
  const closeButton = document.querySelector('[data-blog-calendar-close]');
  const calendarRoot = document.querySelector('[data-blog-calendar-root]');
  const status = document.querySelector('[data-blog-calendar-status]');

  if (!button || !panel || !calendarRoot || !status) {
    return;
  }

  const labels = {
    loading: panel.getAttribute('data-i18n-loading') || 'Loading calendar…',
    error: panel.getAttribute('data-i18n-error') || 'Calendar data could not be loaded.',
  };

  let isInitialized = false;
  let years = {};
  let months = {};
  let days = {};

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function normalizeCountMap(value) {
    if (!value || typeof value !== 'object') {
      return {};
    }

    const map = {};
    for (const [key, rawCount] of Object.entries(value)) {
      const count = Number(rawCount);
      if (!Number.isFinite(count) || count <= 0) {
        continue;
      }
      map[key] = Math.floor(count);
    }

    return map;
  }

  function navigateTo(pathname) {
    if (!pathname) {
      return;
    }
    window.location.assign(pathname);
  }

  async function loadCalendarData() {
    const response = await fetch('/calendar.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('calendar.json request failed');
    }

    const parsed = await response.json();
    years = normalizeCountMap(parsed?.years);
    months = normalizeCountMap(parsed?.months);
    days = normalizeCountMap(parsed?.days);
  }

  function getDateFromClickEvent(event) {
    if (!(event?.target instanceof Element)) {
      return '';
    }

    const dateEl = event.target.closest('[data-vc-date]');
    if (!(dateEl instanceof HTMLElement)) {
      return '';
    }

    return dateEl.dataset.vcDate || '';
  }

  async function initializeCalendar() {
    if (isInitialized) {
      return;
    }

    status.textContent = labels.loading;

    try {
      await loadCalendarData();

      const Calendar = window.VanillaCalendarPro?.Calendar;
      if (typeof Calendar !== 'function') {
        throw new Error('Vanilla Calendar Pro is unavailable');
      }

      const calendar = new Calendar('[data-blog-calendar-root]', {
        onCreateDateEls(_self, dateEl) {
          const dateKey = dateEl.dataset.vcDate || '';
          const count = Number(days[dateKey] || 0);
          const buttonEl = dateEl.querySelector('[data-vc-date-btn]');

          if (!(buttonEl instanceof HTMLElement)) {
            return;
          }

          const existing = buttonEl.querySelector('.blog-calendar-post-count');
          if (existing) {
            existing.remove();
          }

          if (count <= 0) {
            dateEl.removeAttribute('data-blog-calendar-has-posts');
            return;
          }

          dateEl.setAttribute('data-blog-calendar-has-posts', 'true');
          const marker = document.createElement('span');
          marker.className = 'blog-calendar-post-count';
          marker.textContent = String(count);
          buttonEl.appendChild(marker);
        },
        onClickDate(_self, event) {
          const dateKey = getDateFromClickEvent(event);
          if (!dateKey || !days[dateKey]) {
            return;
          }

          const [year, month, day] = dateKey.split('-');
          if (!year || !month || !day) {
            return;
          }

          navigateTo('/' + year + '/' + month + '/' + day + '/');
        },
        onClickMonth(self) {
          const selectedYear = Number(self?.context?.selectedYear);
          const selectedMonth = Number(self?.context?.selectedMonth);

          if (!Number.isInteger(selectedYear) || !Number.isInteger(selectedMonth)) {
            return;
          }

          const monthKey = String(selectedYear) + '-' + pad2(selectedMonth + 1);
          if (!months[monthKey]) {
            return;
          }

          navigateTo('/' + String(selectedYear) + '/' + pad2(selectedMonth + 1) + '/');
        },
        onClickYear(self) {
          const selectedYear = Number(self?.context?.selectedYear);

          if (!Number.isInteger(selectedYear)) {
            return;
          }

          const yearKey = String(selectedYear);
          if (!years[yearKey]) {
            return;
          }

          navigateTo('/' + String(selectedYear) + '/');
        },
      });

      calendar.init();
      status.textContent = '';
      status.setAttribute('hidden', 'hidden');
      isInitialized = true;
    } catch {
      status.textContent = labels.error;
      status.removeAttribute('hidden');
    }
  }

  function setPanelOpen(isOpen) {
    if (isOpen) {
      panel.removeAttribute('hidden');
      void initializeCalendar();
      return;
    }

    panel.setAttribute('hidden', 'hidden');
  }

  button.addEventListener('click', () => {
    const isHidden = panel.hasAttribute('hidden');
    setPanelOpen(isHidden);
  });

  if (closeButton) {
    closeButton.addEventListener('click', () => {
      setPanelOpen(false);
    });
  }
})();`;
