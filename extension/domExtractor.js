/**
 * High-Performance Semantic Accessibility Tree & DOM Extractor for AI Browser Agents
 * Implements Set-of-Marks numeric indexing, visibility pruning, and token-efficient tree serialization.
 */

export function extractPageAccessibilityTree() {
  const INTERACTIVE_SELECTORS = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'option',
    'details',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[onclick]',
    '[tabindex="0"]',
  ];

  const candidates = Array.from(document.querySelectorAll(INTERACTIVE_SELECTORS.join(',')));
  const visibleElements = [];
  let idCounter = 1;

  // Viewport metrics
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const scrollY = window.scrollY || window.pageYOffset;
  const totalHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
  const scrollPercent = totalHeight > viewportHeight ? Math.round((scrollY / (totalHeight - viewportHeight)) * 100) : 100;

  // Helper to check element visibility and non-zero layout geometry
  function isElementVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    
    // Check computed styles
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      style.pointerEvents === 'none'
    ) {
      return false;
    }

    // Check geometry
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) return false;

    // Check if within or reasonably near current viewport
    const isInExtendedViewport =
      rect.bottom >= -200 &&
      rect.top <= viewportHeight + 200 &&
      rect.right >= 0 &&
      rect.left <= viewportWidth;

    return isInExtendedViewport;
  }

  // Helper to extract clean text representation
  function getAccessibleText(el) {
    // Priority: aria-label -> innerText -> title/placeholder -> alt text -> name
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    if (el.getAttribute('aria-labelledby')) {
      const labelledBy = document.getElementById(el.getAttribute('aria-labelledby'));
      if (labelledBy && labelledBy.innerText) return labelledBy.innerText.trim();
    }
    
    const inner = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (inner && inner.length > 0) return inner.slice(0, 100);

    if (el.placeholder) return el.placeholder.trim();
    if (el.title) return el.title.trim();
    if (el.getAttribute('alt')) return el.getAttribute('alt').trim();
    if (el.name) return el.name.trim();

    return '';
  }

  // Iterate over candidates and assign Set-of-Marks tags
  for (const el of candidates) {
    if (!isElementVisible(el)) continue;

    // Check if element is already nested inside an interactive parent we already indexed
    const isRedundantChild = visibleElements.some((item) => {
      const prevEl = document.querySelector(`[data-agent-id="${item.id}"]`);
      return prevEl && prevEl !== el && prevEl.contains(el) && prevEl.tagName === el.tagName;
    });
    if (isRedundantChild) continue;

    const agentId = idCounter++;
    el.setAttribute('data-agent-id', agentId.toString());

    const tag = el.tagName.toLowerCase();
    const item = {
      id: agentId,
      tag,
    };

    const text = getAccessibleText(el);
    if (text) item.text = text;

    if (tag === 'input' || tag === 'textarea') {
      item.type = el.type || 'text';
      if (el.placeholder) item.placeholder = el.placeholder;
      if (el.value) item.value = el.value.slice(0, 60);
      if (el.checked !== undefined && (el.type === 'checkbox' || el.type === 'radio')) {
        item.checked = el.checked;
      }
      if (el.disabled) item.disabled = true;
    }

    if (tag === 'select') {
      const selectedOpt = el.options[el.selectedIndex];
      item.selected = selectedOpt ? selectedOpt.text : '';
      item.options = Array.from(el.options).map((o) => o.text).slice(0, 10);
    }

    if (tag === 'a' && el.href && !el.href.startsWith('javascript:')) {
      try {
        const url = new URL(el.href);
        item.path = url.pathname + url.search;
      } catch (_) {
        item.href = el.href.slice(0, 60);
      }
    }

    if (el.getAttribute('role')) {
      item.role = el.getAttribute('role');
    }

    if (el.getAttribute('aria-expanded')) {
      item.expanded = el.getAttribute('aria-expanded') === 'true';
    }

    visibleElements.push(item);
    if (visibleElements.length >= 80) break; // Token safety boundary
  }

  // Extract key contextual headings (H1-H3) for better orientation
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter(isElementVisible)
    .map((h) => ({
      level: h.tagName.toLowerCase(),
      text: (h.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    }))
    .filter((h) => h.text.length > 0)
    .slice(0, 5);

  return {
    url: window.location.href,
    title: document.title,
    scroll: {
      y: scrollY,
      percent: `${scrollPercent}%`,
      isBottom: scrollPercent >= 98,
      isTop: scrollY <= 10,
    },
    headings,
    interactive_elements: visibleElements,
  };
}
