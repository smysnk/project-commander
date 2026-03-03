'use client';

import React from 'react';
import {
  StyleSheetManager,
  ThemeProvider as StyledThemeProvider,
  createGlobalStyle,
} from 'styled-components';
import { useSelector } from 'react-redux';
import { editorThemes, defaultEditorTheme } from './editorThemeRegistry';

const GlobalStyle = createGlobalStyle`
  html, body {
    margin: 0;
    padding: 0;
    min-height: 100%;
  }

  :root {
    --bg: ${({ theme }) => theme.settings.background};
    --bg-top: ${({ theme }) => theme.settings.backgroundTop};
    --card: ${({ theme }) => theme.settings.card};
    --text: ${({ theme }) => theme.settings.foreground};
    --muted: ${({ theme }) => theme.settings.muted};
    --line: ${({ theme }) => theme.settings.line};
    --accent: ${({ theme }) => theme.settings.accent};
    --accent-strong: ${({ theme }) => theme.settings.accentStrong};
    --error: ${({ theme }) => theme.settings.error};
    --chip: ${({ theme }) => theme.settings.chip};
  }

  body {
    background: radial-gradient(circle at top right, var(--bg-top) 0%, var(--bg) 55%);
    color: var(--text);
    font-family: "Lato", "Work Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    transition: background 0.2s ease, color 0.2s ease;
  }

  * {
    box-sizing: border-box;
  }
`;

const ThemeWrapper = ({ children }) => {
  const style = useSelector((state) => state.userSettings.style);
  const theme = editorThemes[style] || editorThemes[defaultEditorTheme];

  return (
    <StyledThemeProvider theme={theme}>
      <GlobalStyle />
      <StyleSheetManager>{children}</StyleSheetManager>
    </StyledThemeProvider>
  );
};

export default ThemeWrapper;
