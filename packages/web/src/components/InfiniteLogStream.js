'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import windowingUtils from './infinite-log/windowing';

const {
  DEFAULT_LINE_HEIGHT_PX,
  DEFAULT_OVERSCAN_ABOVE_LINES,
  DEFAULT_OVERSCAN_BELOW_LINES,
  computeTagRowStyle,
  computeWindowFromScroll,
  computeStreamWindowRequests,
  flattenLoadedStreamLines,
  getTotalLineCount,
} = windowingUtils;

const setRefValue = (ref, value) => {
  if (!ref) {
    return;
  }
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  ref.current = value;
};

const InfiniteLogStream = forwardRef(({
  streams = [],
  lineHeight = DEFAULT_LINE_HEIGHT_PX,
  overscanAbove = DEFAULT_OVERSCAN_ABOVE_LINES,
  overscanBelow = DEFAULT_OVERSCAN_BELOW_LINES,
  renderLineText,
  renderLineTags,
  onWindowRequest,
  onScroll,
  className = '',
  dataTestId = 'log-stream',
}, forwardedRef) => {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const lastWindowRequestSignatureRef = useRef('');

  const normalizedLineHeight = Math.max(1, Number.parseInt(lineHeight, 10) || DEFAULT_LINE_HEIGHT_PX);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return undefined;
    }

    const updateViewportHeight = () => {
      setViewportHeight(node.clientHeight || 0);
    };
    updateViewportHeight();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportHeight);
      return () => {
        window.removeEventListener('resize', updateViewportHeight);
      };
    }

    const observer = new ResizeObserver(() => {
      updateViewportHeight();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const totalLines = useMemo(
    () => getTotalLineCount(streams),
    [streams],
  );

  const windowRange = useMemo(() => (
    computeWindowFromScroll({
      scrollTop,
      viewportHeight,
      lineHeight: normalizedLineHeight,
      overscanAbove,
      overscanBelow,
      totalLines,
    })
  ), [
    normalizedLineHeight,
    overscanAbove,
    overscanBelow,
    scrollTop,
    totalLines,
    viewportHeight,
  ]);

  const lineEntriesByGlobalIndex = useMemo(() => {
    const map = new Map();
    const flattened = flattenLoadedStreamLines(streams);
    for (const lineEntry of flattened) {
      map.set(lineEntry.globalIndex, lineEntry);
    }
    return map;
  }, [streams]);

  const renderedRows = useMemo(() => {
    const rows = [];
    for (let globalIndex = windowRange.start; globalIndex < windowRange.endExclusive; globalIndex += 1) {
      const lineEntry = lineEntriesByGlobalIndex.get(globalIndex) || null;
      rows.push({
        globalIndex,
        localIndex: globalIndex - windowRange.start,
        lineEntry,
      });
    }
    return rows;
  }, [lineEntriesByGlobalIndex, windowRange.endExclusive, windowRange.start]);

  const textBlockValue = useMemo(() => (
    renderedRows
      .map((row) => {
        if (!row.lineEntry) {
          return '';
        }
        if (typeof renderLineText === 'function') {
          return String(renderLineText(row.lineEntry.line, row.lineEntry) || '');
        }
        return String(row.lineEntry.line?.message || '');
      })
      .join('\n')
  ), [renderLineText, renderedRows]);

  useEffect(() => {
    if (typeof onWindowRequest !== 'function') {
      return;
    }
    const streamsToLoad = computeStreamWindowRequests({
      streams,
      start: windowRange.start,
      endExclusive: windowRange.endExclusive,
    });
    const signature = JSON.stringify({
      start: windowRange.start,
      endExclusive: windowRange.endExclusive,
      streams: streamsToLoad,
    });
    if (lastWindowRequestSignatureRef.current === signature) {
      return;
    }
    lastWindowRequestSignatureRef.current = signature;
    onWindowRequest({
      window: windowRange,
      streams: streamsToLoad,
      totalLines,
    });
  }, [
    onWindowRequest,
    streams,
    totalLines,
    windowRange,
  ]);

  const topSpacerHeight = Math.max(0, windowRange.start * normalizedLineHeight);
  const bottomSpacerHeight = Math.max(0, (totalLines - windowRange.endExclusive) * normalizedLineHeight);
  const windowHeight = Math.max(normalizedLineHeight, renderedRows.length * normalizedLineHeight);

  const handleScroll = (event) => {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop || 0);
    if (typeof onScroll === 'function') {
      onScroll(event);
    }
  };

  return (
    <div
      className={`logStream infiniteLogStream ${className}`.trim()}
      ref={(node) => {
        containerRef.current = node;
        setRefValue(forwardedRef, node);
      }}
      onScroll={handleScroll}
      data-testid={dataTestId}
    >
      <div style={{ height: `${topSpacerHeight}px` }} aria-hidden />
      <div className="infiniteLogWindow" style={{ height: `${windowHeight}px` }}>
        <div className="infiniteLogColumns">
          <div
            className="infiniteLogTagColumn"
            data-testid="infinite-log-tag-column"
            style={{ height: `${windowHeight}px` }}
          >
            {renderedRows.map((row) => {
              const lineEntry = row.lineEntry;
              if (!lineEntry) {
                return null;
              }
              const tagRowStyle = computeTagRowStyle({
                localIndex: row.localIndex,
                lineHeight: normalizedLineHeight,
              });
              return (
                <div
                  key={`${lineEntry.streamId}-${lineEntry.streamLineIndex}-${row.globalIndex}`}
                  className={`infiniteLogTagRow logLine ${String(lineEntry?.line?.stream || 'stdout').trim().toLowerCase()}`}
                  style={{
                    top: `${tagRowStyle.top}px`,
                    height: `${tagRowStyle.height}px`,
                    lineHeight: `${tagRowStyle.lineHeight}px`,
                  }}
                >
                  {typeof renderLineTags === 'function'
                    ? renderLineTags(lineEntry.line, lineEntry)
                    : null}
                </div>
              );
            })}
          </div>
          <pre
            className="infiniteLogTextBlock"
            data-testid="infinite-log-text-block"
            style={{
              lineHeight: `${normalizedLineHeight}px`,
            }}
          >
            {textBlockValue}
          </pre>
        </div>
      </div>
      <div style={{ height: `${bottomSpacerHeight}px` }} aria-hidden />
    </div>
  );
});

InfiniteLogStream.displayName = 'InfiniteLogStream';

export default InfiniteLogStream;
