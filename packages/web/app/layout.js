import './globals.css';
import StoreProvider from '../src/store/StoreProvider';

export const metadata = {
  title: 'Project Commander',
  description: 'Scan folders and discover project types',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
