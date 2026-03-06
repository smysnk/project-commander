import { useMemo } from 'react';

export default function useRightPaneController({
  rightTab,
  onSelectRightTab,
}) {
  return useMemo(() => ({
    rightTab,
    onSelectRightTab,
  }), [onSelectRightTab, rightTab]);
}
