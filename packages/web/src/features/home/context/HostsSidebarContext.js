import createRequiredContext from './createRequiredContext';

export const [HostsSidebarContext, useHostsSidebarContext] = createRequiredContext(
  'HostsSidebarContext',
  'Wrap component tree in HostsSidebarProvider.',
);

export function HostsSidebarProvider({ value, children }) {
  return (
    <HostsSidebarContext.Provider value={value}>
      {children}
    </HostsSidebarContext.Provider>
  );
}
