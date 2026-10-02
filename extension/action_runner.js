/**
 * Advanced Browser Action Runner & Tool Execution Engine for ChatGPT
 * Implements high-reliability element resolution, simulated pointer events,
 * form manipulation, and human-like typing behaviors.
 */

import { extractPageAccessibilityTree } from './domExtractor.js';
import { highlightElement } from './visualOverlay.js';

export class ActionRunner {
  /**
   * Find target element using Set-of-Marks ID, CSS selector, or accessible name fallback
   */
  static findElement(action) {
    // 1. Match by numeric Set-of-Marks agent ID
    if (action.element_id !== undefined && action.element_id !== null) {
      const el = document.querySelector(`[data-agent-id="${action.element_id}"]`);
      if (el) return el;
    }

    // 2. Match by direct CSS selector
    if (action.selector) {
      try {
        const el = document.querySelector(action.selector);
        if (el) return el;
      } catch (_) {}
    }

    // 3. Fallback: Match by exact text or aria-label
    if (action.text_target) {
      const targetLower = action.text_target.toLowerCase().trim();
      const allInteractive = document.querySelectorAll('button, a, input, [role="button"]');
      for (const el of allInteractive) {
        const text = (el.innerText || el.getAttribute('aria-label') || el.value || '').toLowerCase().trim();
        if (text === targetLower || (text.length > 0 && text.includes(targetLower))) {
          return el;
        }
      }
    }

    return null;
  }

  /**
   * Execute an action command object
   */
  static async execute(action) {
    const actionName = (action.action || '').toLowerCase();

    switch (actionName) {
      case 'click':
        return await this.click(action);

      case 'type':
        return await this.type(action);

      case 'select_option':
        return await this.selectOption(action);

      case 'hover':
        return await this.hover(action);

      case 'scroll':
        return await this.scroll(action);

      case 'key_press':
        return await this.keyPress(action);

      case 'extract_data':
        return await this.extractData(action);

      case 'wait':
        return await this.wait(action);

      case 'extract_dom':
      case 'inspect':
        return {
          status: 'success',
          action_executed: 'inspect',
          tree: extractPageAccessibilityTree(),
        };

      default:
        return {
          status: 'error',
          error_message: `Unsupported action type: "${action.action}"`,
        };
    }
  }

  /**
   * Tool: Click an element with visual highlight & realistic pointer sequence
   */
  static async click(action) {
    const el = this.findElement(action);
    if (!el) {
      return {
        status: 'error',
        error_message: `Click failed: Element [${action.element_id || action.selector}] not found on page.`,
      };
    }

    // Scroll element to center
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    await new Promise((r) => setTimeout(r, 150));

    // Show visual highlight
    highlightElement(el, 'click', action.element_id ? `[${action.element_id}]` : '');

    // Focus element
    if (typeof el.focus === 'function') el.focus();

    // Trigger full mouse event lifecycle
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
    };

    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((evtType) => {
      el.dispatchEvent(new MouseEvent(evtType, eventInit));
    });

    // Special handling for form submit buttons
    if (el.type === 'submit' && el.form) {
      el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }

    return {
      status: 'success',
      action_executed: 'click',
      target: {
        tag: el.tagName.toLowerCase(),
        id: action.element_id,
        text: (el.innerText || el.value || '').slice(0, 40),
      },
    };
  }

  /**
   * Tool: Type text into inputs, textareas, or contenteditables
   */
  static async type(action) {
    const el = this.findElement(action);
    if (!el) {
      return {
        status: 'error',
        error_message: `Type failed: Element [${action.element_id || action.selector}] not found.`,
      };
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise((r) => setTimeout(r, 100));

    highlightElement(el, 'type', action.element_id ? `[${action.element_id}]` : '');
    if (typeof el.focus === 'function') el.focus();

    const textToType = action.text !== undefined ? String(action.text) : '';
    const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';

    // Set input value
    if ('value' in el && !isContentEditable) {
      if (action.clear_first !== false) {
        el.value = '';
      }
      el.value = (el.value || '') + textToType;
    } else {
      if (action.clear_first !== false) {
        el.innerText = '';
      }
      el.innerText = (el.innerText || '') + textToType;
    }

    // Dispatch input & change events
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));

    // Optional Enter key press
    if (action.press_enter) {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

      const form = el.closest('form');
      if (form) {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    }

    return {
      status: 'success',
      action_executed: 'type',
      target: {
        id: action.element_id,
        text_entered: textToType,
        pressed_enter: !!action.press_enter,
      },
    };
  }

  /**
   * Tool: Select dropdown option by text or value
   */
  static async selectOption(action) {
    const el = this.findElement(action);
    if (!el || el.tagName.toLowerCase() !== 'select') {
      return { status: 'error', error_message: `Select option failed: Valid <select> element not found.` };
    }

    highlightElement(el, 'click');
    const optionText = (action.option || action.value || '').toLowerCase().trim();
    let matched = false;

    for (let i = 0; i < el.options.length; i++) {
      const opt = el.options[i];
      if (
        opt.value.toLowerCase() === optionText ||
        opt.text.toLowerCase().includes(optionText)
      ) {
        el.selectedIndex = i;
        matched = true;
        break;
      }
    }

    if (!matched && el.options.length > 0) {
      el.selectedIndex = 0;
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    return {
      status: 'success',
      action_executed: 'select_option',
      selected: el.options[el.selectedIndex]?.text,
    };
  }

  /**
   * Tool: Hover element to trigger tooltips or dropdown menus
   */
  static async hover(action) {
    const el = this.findElement(action);
    if (!el) {
      return { status: 'error', error_message: `Hover failed: Element not found.` };
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightElement(el, 'click');

    ['mouseenter', 'mouseover', 'mousemove'].forEach((evt) => {
      el.dispatchEvent(new MouseEvent(evt, { bubbles: true, cancelable: true, view: window }));
    });

    return { status: 'success', action_executed: 'hover' };
  }

  /**
   * Tool: Scroll page or container
   */
  static async scroll(action) {
    const direction = action.direction || 'down';
    const amount = action.amount || 600;

    if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } else if (direction === 'up') {
      window.scrollBy({ top: -amount, behavior: 'smooth' });
    } else {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }

    await new Promise((r) => setTimeout(r, 400));
    return { status: 'success', action_executed: 'scroll', direction, amount };
  }

  /**
   * Tool: Send keyboard keys
   */
  static async keyPress(action) {
    const key = action.key || 'Enter';
    const active = document.activeElement || document.body;

    active.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    active.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));

    return { status: 'success', action_executed: 'key_press', key };
  }

  /**
   * Tool: Extract structured text or table data from the page
   */
  static async extractData(action) {
    let target = document.querySelector('main, article, [role="main"]') || document.body;
    if (action.selector) {
      const custom = document.querySelector(action.selector);
      if (custom) target = custom;
    }

    const cleanText = (target.innerText || '').slice(0, 4000);
    return {
      status: 'success',
      action_executed: 'extract_data',
      extracted_content: cleanText,
    };
  }

  /**
   * Tool: Wait for async content loading
   */
  static async wait(action) {
    const sec = Math.min(Math.max(action.seconds || 2, 1), 20);
    await new Promise((r) => setTimeout(r, sec * 1000));
    return { status: 'success', action_executed: 'wait', waited_seconds: sec };
  }
}
