import createRequiredContext from './createRequiredContext';

export const [EnvironmentPanelContext, useEnvironmentPanelContext] = createRequiredContext(
  'EnvironmentPanelContext',
  'Wrap component tree in EnvironmentPanelProvider.',
);

export function EnvironmentPanelProvider({ value, children }) {
  return (
    <EnvironmentPanelContext.Provider value={value}>
      {children}
    </EnvironmentPanelContext.Provider>
  );
}
