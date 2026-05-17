import { useEffect, useState } from 'react';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toUniqueLabels(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
}

export default function useTagColumnWidth({
  values,
  minWidth = 56,
  maxWidth = 180,
  fallbackWidth = minWidth,
  containerRef = null,
  maxFraction = 1,
}) {
  const [resolvedWidth, setResolvedWidth] = useState(fallbackWidth);
  const valuesKey = toUniqueLabels(values).join('\n');

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const labels = valuesKey ? valuesKey.split('\n') : [];
    const measureTarget = document.createElement('span');
    measureTarget.className = 'tagChip tagChip--left tagChipMeasure';
    document.body.appendChild(measureTarget);

    const computeWidth = () => {
      const containerWidth = Number(containerRef?.current?.clientWidth) || 0;
      const boundedMaxWidth = containerWidth > 0
        ? Math.min(maxWidth, Math.floor(containerWidth * maxFraction))
        : maxWidth;
      const effectiveMaxWidth = Math.max(minWidth, boundedMaxWidth);
      let nextWidth = fallbackWidth;

      for (const label of labels) {
        measureTarget.textContent = label;
        const chipWidth = Math.ceil(measureTarget.getBoundingClientRect().width);
        if (chipWidth > nextWidth) {
          nextWidth = chipWidth;
        }
      }

      setResolvedWidth((previous) => {
        const boundedWidth = clamp(nextWidth, minWidth, effectiveMaxWidth);
        return previous === boundedWidth ? previous : boundedWidth;
      });
    };

    computeWidth();

    let observer = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef?.current) {
      observer = new ResizeObserver(() => computeWidth());
      observer.observe(containerRef.current);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', computeWidth);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      } else if (typeof window !== 'undefined') {
        window.removeEventListener('resize', computeWidth);
      }
      measureTarget.remove();
    };
  }, [containerRef, fallbackWidth, maxFraction, maxWidth, minWidth, valuesKey]);

  return resolvedWidth;
}
