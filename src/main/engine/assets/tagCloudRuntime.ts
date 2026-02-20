export const TAG_CLOUD_RUNTIME_JS = String.raw`(function () {
  function parseWords(rawWords) {
    if (!rawWords || typeof rawWords !== 'string') {
      return [];
    }

    try {
      const parsed = JSON.parse(rawWords);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function clamp01(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    if (value < 0) {
      return 0;
    }

    if (value > 1) {
      return 1;
    }

    return value;
  }

  function parseCssColor(colorValue) {
    if (typeof colorValue !== 'string') {
      return null;
    }

    const value = colorValue.trim();
    if (!value) {
      return null;
    }

    const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      if (hex.length === 3) {
        return [
          Number.parseInt(hex[0] + hex[0], 16),
          Number.parseInt(hex[1] + hex[1], 16),
          Number.parseInt(hex[2] + hex[2], 16),
        ];
      }

      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ];
    }

    const rgbMatch = value.match(/^rgba?\\(([^)]+)\\)$/i);
    if (rgbMatch) {
      const channels = rgbMatch[1]
        .split(',')
        .map((channel) => channel.trim())
        .slice(0, 3)
        .map((channel) => {
          if (channel.endsWith('%')) {
            return Math.round((Number.parseFloat(channel) / 100) * 255);
          }

          return Math.round(Number.parseFloat(channel));
        });

      if (channels.length === 3 && channels.every((channel) => Number.isFinite(channel))) {
        return channels.map((channel) => Math.max(0, Math.min(255, channel)));
      }
    }

    return null;
  }

  function interpolateColor(fromColor, toColor, t) {
    return [
      Math.round(fromColor[0] + ((toColor[0] - fromColor[0]) * t)),
      Math.round(fromColor[1] + ((toColor[1] - fromColor[1]) * t)),
      Math.round(fromColor[2] + ((toColor[2] - fromColor[2]) * t)),
    ];
  }

  function mixColor(fromColor, toColor, weight) {
    return interpolateColor(fromColor, toColor, clamp01(weight));
  }

  function colorToCss(color) {
    return 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';
  }

  function getPicoThemeStops() {
    const style = window.getComputedStyle(document.documentElement);

    const blue = parseCssColor(style.getPropertyValue('--pico-secondary')) || [74, 99, 146];
    const green = parseCssColor(style.getPropertyValue('--pico-ins-color')) || [53, 117, 56];
    const red = parseCssColor(style.getPropertyValue('--pico-del-color')) || [183, 72, 72];

    const yellow = mixColor(green, red, 0.45);
    const orange = mixColor(green, red, 0.72);

    return [blue, green, yellow, orange, red];
  }

  function interpolateStops(stops, value) {
    if (!Array.isArray(stops) || stops.length === 0) {
      return 'currentColor';
    }

    if (stops.length === 1) {
      return colorToCss(stops[0]);
    }

    const clamped = clamp01(value);
    const scaled = clamped * (stops.length - 1);
    const lowerIndex = Math.floor(scaled);
    const upperIndex = Math.min(stops.length - 1, lowerIndex + 1);
    const localT = scaled - lowerIndex;

    return colorToCss(interpolateColor(stops[lowerIndex], stops[upperIndex], localT));
  }

  function resolveQuantileColorMap(words) {
    const counts = Array.from(
      new Set(words.map((word) => Number(word.count)).filter((count) => Number.isFinite(count)))
    ).sort((a, b) => a - b);

    const quantiles = new Map();
    if (counts.length === 0) {
      return quantiles;
    }

    if (counts.length === 1) {
      quantiles.set(counts[0], 1);
      return quantiles;
    }

    counts.forEach((count, index) => {
      quantiles.set(count, index / (counts.length - 1));
    });

    return quantiles;
  }

  function applyThemeAwareColors(words, container) {
    const gammaRaw = Number.parseFloat(container.getAttribute('data-color-easing') || '0.7');
    const gamma = Number.isFinite(gammaRaw) && gammaRaw > 0 ? gammaRaw : 0.7;
    const quantiles = resolveQuantileColorMap(words);
    const stops = getPicoThemeStops();

    return words.map((word) => {
      const count = Number(word.count);
      const quantile = quantiles.get(count) ?? 0;
      const eased = Math.pow(clamp01(quantile), gamma);

      return {
        ...word,
        color: interpolateStops(stops, eased),
      };
    });
  }

  function drawTagCloud(container) {
    const cloudFactory = window.d3 && window.d3.layout && typeof window.d3.layout.cloud === 'function'
      ? window.d3.layout.cloud
      : null;

    if (!cloudFactory) {
      return;
    }

    const rawWords = container.getAttribute('data-tag-cloud-words');
    const words = parseWords(rawWords);
    if (words.length === 0) {
      return;
    }

    const colorDistribution = container.getAttribute('data-color-distribution') || 'quantile';
    const colorTheme = container.getAttribute('data-color-theme') || 'pico';
    const coloredWords = colorDistribution === 'quantile' && colorTheme === 'pico'
      ? applyThemeAwareColors(words, container)
      : words;

    const width = Number.parseInt(container.getAttribute('data-width') || '900', 10) || 900;
    const height = Number.parseInt(container.getAttribute('data-height') || '420', 10) || 420;
    const orientation = container.getAttribute('data-orientation') || 'horizontal';

    const resolveRotation = () => {
      if (orientation === 'mixed-hv') {
        return Math.random() < 0.5 ? 0 : 90;
      }

      if (orientation === 'mixed-diagonal') {
        const diagonalAngles = [-60, -30, 0, 30, 60, 90];
        const index = Math.floor(Math.random() * diagonalAngles.length);
        return diagonalAngles[index];
      }

      return 0;
    };

    const svgNode = container.querySelector('svg.tag-cloud-canvas');
    if (!svgNode) {
      return;
    }

    while (svgNode.firstChild) {
      svgNode.removeChild(svgNode.firstChild);
    }

    cloudFactory()
      .size([width, height])
      .words(coloredWords.map((word) => ({ ...word })))
      .padding(4)
      .rotate(() => resolveRotation())
      .font('sans-serif')
      .fontSize((word) => word.size)
      .on('end', (layoutWords) => {
        svgNode.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        svgNode.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('transform', 'translate(' + (width / 2) + ',' + (height / 2) + ')');

        for (const word of layoutWords) {
          const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          textNode.textContent = word.text;
          textNode.setAttribute('text-anchor', 'middle');
          textNode.setAttribute('transform', 'translate(' + word.x + ',' + word.y + ')rotate(' + (word.rotate || 0) + ')');
          textNode.style.fontFamily = 'sans-serif';
          textNode.style.fontSize = word.size + 'px';
          textNode.style.fill = typeof word.color === 'string' && word.color.length > 0
            ? word.color
            : 'currentColor';
          textNode.style.cursor = 'pointer';
          textNode.style.opacity = '0.9';

          const titleNode = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          titleNode.textContent = word.text + ' (' + word.count + ')';
          textNode.appendChild(titleNode);

          textNode.addEventListener('click', () => {
            if (word && typeof word.url === 'string' && word.url.length > 0) {
              window.location.assign(word.url);
            }
          });

          group.appendChild(textNode);
        }

        svgNode.appendChild(group);
      })
      .start();
  }

  function initTagClouds() {
    const containers = document.querySelectorAll('[data-tag-cloud="true"]');
    containers.forEach((container) => drawTagCloud(container));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTagClouds, { once: true });
  } else {
    initTagClouds();
  }
})();
`;
