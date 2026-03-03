export const EditorThemeEnum = {
  GITHUB_LIGHT: 'GITHUB_LIGHT',
  GITHUB_DARK: 'GITHUB_DARK',
  DRACULA: 'DRACULA',
  MATERIAL: 'MATERIAL',
  ECLIPSE: 'ECLIPSE',
};

export const editorThemes = {
  [EditorThemeEnum.GITHUB_LIGHT]: {
    name: 'GitHub Light',
    mode: 'light',
    settings: {
      background: '#f6f8fa',
      backgroundTop: '#e7efff',
      foreground: '#24292f',
      card: '#ffffff',
      muted: '#57606a',
      line: '#d0d7de',
      accent: '#0969da',
      accentStrong: '#0550ae',
      error: '#cf222e',
      chip: '#f6f8fa',
    },
  },
  [EditorThemeEnum.GITHUB_DARK]: {
    name: 'GitHub Dark',
    mode: 'dark',
    settings: {
      background: '#0d1117',
      backgroundTop: '#1c2533',
      foreground: '#e6edf3',
      card: '#161b22',
      muted: '#9aa4b2',
      line: '#30363d',
      accent: '#2f81f7',
      accentStrong: '#1f6feb',
      error: '#f85149',
      chip: '#0f1723',
    },
  },
  [EditorThemeEnum.DRACULA]: {
    name: 'Dracula',
    mode: 'dark',
    settings: {
      background: '#282a36',
      backgroundTop: '#1f2230',
      foreground: '#f8f8f2',
      card: '#303241',
      muted: '#bdc1cc',
      line: '#44475a',
      accent: '#ff79c6',
      accentStrong: '#ff5cb8',
      error: '#ff5555',
      chip: '#2a2d3b',
    },
  },
  [EditorThemeEnum.MATERIAL]: {
    name: 'Material',
    mode: 'dark',
    settings: {
      background: '#263238',
      backgroundTop: '#1f2a30',
      foreground: '#eeffff',
      card: '#2f3b43',
      muted: '#b0bec5',
      line: '#455a64',
      accent: '#80cbc4',
      accentStrong: '#5bb8af',
      error: '#ff5370',
      chip: '#2a3640',
    },
  },
  [EditorThemeEnum.ECLIPSE]: {
    name: 'Eclipse',
    mode: 'light',
    settings: {
      background: '#f7f7f7',
      backgroundTop: '#e5f2ff',
      foreground: '#2c3e50',
      card: '#ffffff',
      muted: '#5d7285',
      line: '#d2dbe3',
      accent: '#1f6feb',
      accentStrong: '#1558b0',
      error: '#b42318',
      chip: '#eef4fb',
    },
  },
};

export const defaultEditorThemes = [
  EditorThemeEnum.GITHUB_LIGHT,
  EditorThemeEnum.GITHUB_DARK,
  EditorThemeEnum.DRACULA,
  EditorThemeEnum.MATERIAL,
  EditorThemeEnum.ECLIPSE,
];

export const defaultEditorTheme = EditorThemeEnum.GITHUB_LIGHT;
