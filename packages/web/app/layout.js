import './globals.css';
import StoreProvider from '../src/store/StoreProvider';
import { isAuthEnabled } from '../src/lib/auth-env';

export const metadata = {
  title: 'Project Commander',
  description: 'Scan folders and discover project types',
};

export default function RootLayout({ children }) {
  const authEnabled = isAuthEnabled();
  return (
    <html lang="en">
      <body>
        <StoreProvider authEnabled={authEnabled}>{children}</StoreProvider>
      </body>
    </html>
  );
}
