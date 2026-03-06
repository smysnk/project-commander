import { createContext, useContext } from 'react';

export default function createRequiredContext(displayName, missingProviderHint) {
  const Context = createContext(undefined);
  Context.displayName = displayName;

  const useRequiredValue = () => {
    const value = useContext(Context);
    if (value === undefined) {
      throw new Error(`${displayName} is unavailable. ${missingProviderHint}`);
    }
    return value;
  };

  return [Context, useRequiredValue];
}
