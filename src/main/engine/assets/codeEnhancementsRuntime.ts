export const CODE_ENHANCEMENTS_RUNTIME_JS = String.raw`(function () {
  function resolveCodeLanguage(codeElement) {
    if (!codeElement) {
      return '';
    }

    var direct = codeElement.getAttribute('data-code-language');
    if (typeof direct === 'string' && direct.trim()) {
      return direct.trim().toLowerCase();
    }

    var className = codeElement.className || '';
    var classMatch = className.match(/(?:^|\s)language-([\w.+-]+)/i);
    if (classMatch && classMatch[1]) {
      return classMatch[1].toLowerCase();
    }

    return '';
  }

  function fallbackCopy(value) {
    var textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async function copyCodeToClipboard(value) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        return fallbackCopy(value);
      }
    }

    return fallbackCopy(value);
  }

  function ensureCopyButton(preElement, codeElement) {
    if (!preElement || preElement.querySelector(':scope > .code-copy-button')) {
      return;
    }

    preElement.classList.add('code-block-enhanced');

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy-button';
    button.setAttribute('aria-hidden', 'true');

    var icon = document.createElement('span');
    icon.className = 'code-copy-icon';
    icon.textContent = '⧉';
    button.appendChild(icon);

    button.addEventListener('click', async function () {
      var codeText = codeElement.textContent || '';
      var copied = await copyCodeToClipboard(codeText);
      preElement.classList.remove('code-copy-failed');
      preElement.classList.remove('code-copy-success');
      preElement.classList.add(copied ? 'code-copy-success' : 'code-copy-failed');

      if (copied) {
        icon.textContent = '✓';
        window.setTimeout(function () {
          preElement.classList.remove('code-copy-success');
          icon.textContent = '⧉';
        }, 1200);
        return;
      }

      window.setTimeout(function () {
        preElement.classList.remove('code-copy-failed');
      }, 1200);
    });

    preElement.appendChild(button);
  }

  function highlightCodeBlock(codeElement) {
    var highlighter = window.hljs;
    if (!highlighter || typeof highlighter.highlightElement !== 'function') {
      return;
    }

    if (codeElement.getAttribute('data-code-highlighted') === 'true') {
      return;
    }

    try {
      highlighter.highlightElement(codeElement);
      codeElement.setAttribute('data-code-highlighted', 'true');
    } catch {
    }
  }

  function initCodeBlocks() {
    var codeNodes = document.querySelectorAll('pre > code');
    codeNodes.forEach(function (codeElement) {
      var preElement = codeElement.parentElement;
      if (!preElement || preElement.tagName !== 'PRE') {
        return;
      }

      var language = resolveCodeLanguage(codeElement);
      if (language) {
        codeElement.setAttribute('data-code-language', language);
        preElement.setAttribute('data-code-language', language);
      }

      ensureCopyButton(preElement, codeElement);
      highlightCodeBlock(codeElement);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCodeBlocks, { once: true });
  } else {
    initCodeBlocks();
  }
})();
`;
