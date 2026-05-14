'use client';

import { Provider } from 'react-redux';
import { SessionProvider } from 'next-auth/react';
import { wrapper } from './index';
import ThemeWrapper from '../components/ThemeWrapper';

export default function StoreProvider({ children, initialState, authEnabled = false }) {
  const { store } = wrapper.useWrappedStore({ initialState });
  const content = (
    <Provider store={store}>
      <ThemeWrapper>{children}</ThemeWrapper>
    </Provider>
  );

  if (authEnabled) {
    return (
      <SessionProvider>
        {content}
      </SessionProvider>
    );
  }

  return (
    content
  );
}
