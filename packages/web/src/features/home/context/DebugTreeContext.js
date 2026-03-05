import { createContext, useContext } from 'react';

const DebugTreeContext = createContext(null);

export function DebugTreeProvider({ value, children }) {
  return (
    <DebugTreeContext.Provider value={value}>
      {children}
    </DebugTreeContext.Provider>
  );
}

export function useDebugTreeContext() {
  const contextValue = useContext(DebugTreeContext);
  if (!contextValue) {
    throw new Error('useDebugTreeContext must be used within DebugTreeProvider');
  }
  return contextValue;
}
