'use client';

import { Provider } from 'react-redux';
import { wrapper } from './index';
import ThemeWrapper from '../components/ThemeWrapper';

export default function StoreProvider({ children, initialState }) {
  const { store } = wrapper.useWrappedStore({ initialState });
  return (
    <Provider store={store}>
      <ThemeWrapper>{children}</ThemeWrapper>
    </Provider>
  );
}
