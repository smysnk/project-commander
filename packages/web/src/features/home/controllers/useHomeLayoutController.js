import { useCallback, useEffect, useMemo } from 'react';
import {
  setPanelProjectListLayout,
  setUiHostsSidebarWidthPx,
} from '../../../store';
import {
  HOSTS_SIDEBAR_WIDTH_MAX,
  HOSTS_SIDEBAR_WIDTH_MIN,
} from '../constants/ui';
import { clampSidebarWidth } from '../lib/homeUtils';

const clampWidth = (value) => Math.max(20, Math.min(80, Math.round(value)));

export default function useHomeLayoutController({
  dispatch,
  hostsSidebarCollapsed,
  resizing,
  setResizing,
  workspaceRef,
  mainPanelsRef,
  resizingRef,
  resizingHandleRef,
}) {
  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!resizingRef.current || !workspaceRef.current) {
        return;
      }

      const activeHandle = resizingHandleRef.current || 'content';
      if (activeHandle === 'sidebar') {
        if (hostsSidebarCollapsed) {
          return;
        }
        const workspaceRect = workspaceRef.current.getBoundingClientRect();
        if (workspaceRect.width <= 0) {
          return;
        }
        const maxAllowedWidth = Math.max(
          HOSTS_SIDEBAR_WIDTH_MIN,
          Math.min(HOSTS_SIDEBAR_WIDTH_MAX, workspaceRect.width - 320),
        );
        const nextWidth = clampSidebarWidth(event.clientX - workspaceRect.left, {
          max: maxAllowedWidth,
        });
        dispatch(setUiHostsSidebarWidthPx(nextWidth));
        return;
      }

      const rect = mainPanelsRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) {
        return;
      }
      const ratio = ((event.clientX - rect.left) / rect.width) * 100;
      dispatch(setPanelProjectListLayout({ leftWidthPct: clampWidth(ratio) }));
    };

    const handleMouseUp = () => {
      if (!resizingRef.current) {
        return;
      }

      resizingRef.current = false;
      resizingHandleRef.current = null;
      setResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    dispatch,
    hostsSidebarCollapsed,
    mainPanelsRef,
    resizingHandleRef,
    resizingRef,
    setResizing,
    workspaceRef,
  ]);

  const onStartResize = useCallback((event, handle = 'content') => {
    event.preventDefault();
    resizingRef.current = true;
    resizingHandleRef.current = handle === 'sidebar' ? 'sidebar' : 'content';
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [resizingHandleRef, resizingRef, setResizing]);

  return useMemo(() => ({
    workspaceRef,
    mainPanelsRef,
    hostsSidebarCollapsed,
    resizing,
    resizingHandleRef,
    onStartResize,
  }), [
    hostsSidebarCollapsed,
    mainPanelsRef,
    onStartResize,
    resizing,
    resizingHandleRef,
    workspaceRef,
  ]);
}
