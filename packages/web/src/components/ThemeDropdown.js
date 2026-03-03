'use client';

import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useSelector, useDispatch } from 'react-redux';
import { setUserStyle } from '../store';
import { editorThemes } from './editorThemeRegistry';

const Wrapper = styled.div`
  position: relative;
  margin: 0;
`;

const Trigger = styled.button`
  background: ${({ theme }) => theme.settings.background};
  color: ${({ theme }) => theme.settings.foreground};
  border: 1px solid ${({ theme }) => theme.settings.foreground};
  padding: 6px 34px 6px 10px;
  border-radius: 8px;
  font-size: 0.95rem;
  line-height: 1.2;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  min-width: 130px;
  text-align: left;
  position: relative;

  &:hover {
    transform: translateY(-1px);
  }

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.settings?.foreground || '#8aa4ff'};
    box-shadow: 0 0 0 3px rgba(138, 164, 255, 0.25);
  }
`;

const Arrow = styled.span`
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%) rotate(${({ $open }) => ($open ? '180deg' : '0deg')});
  transition: transform 0.15s ease;
  pointer-events: none;
`;

const Menu = styled.ul`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  list-style: none;
  margin: 0;
  padding: 6px;
  min-width: 180px;
  background: ${({ theme }) => theme.settings.background};
  color: ${({ theme }) => theme.settings.foreground};
  border: 1px solid ${({ theme }) => theme.settings.foreground};
  border-radius: 8px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28);
`;

const Item = styled.button`
  width: 100%;
  border: 0;
  border-radius: 6px;
  text-align: left;
  padding: 8px 10px;
  background: ${({ $active }) => ($active ? 'rgba(138, 164, 255, 0.16)' : 'transparent')};
  color: ${({ theme }) => theme.settings.foreground};
  font-size: 0.92rem;
  cursor: pointer;

  &:hover {
    background: rgba(138, 164, 255, 0.16);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px rgba(138, 164, 255, 0.25);
  }
`;

const ThemeDropdown = () => {
  const wrapperRef = useRef(null);
  const [open, setOpen] = useState(false);
  const themes = useSelector((state) => state.settings.themes);
  const editorTheme = useSelector((state) => state.userSettings.style);
  const dispatch = useDispatch();

  const handleSelect = (value) => {
    if (themes.includes(value)) {
      dispatch(setUserStyle(value));
    }
    setOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  if (!themes || themes.length === 0) {
    return null;
  }

  const selectedLabel = editorThemes[editorTheme]?.name || editorTheme;

  return (
    <Wrapper ref={wrapperRef}>
      <Trigger
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selectedLabel}
        <Arrow $open={open}>▾</Arrow>
      </Trigger>
      {open ? (
        <Menu role="listbox">
          {themes.map((themeKey) => (
            <li key={themeKey}>
              <Item
                type="button"
                $active={themeKey === editorTheme}
                onClick={() => handleSelect(themeKey)}
              >
                {editorThemes[themeKey]?.name || themeKey}
              </Item>
            </li>
          ))}
        </Menu>
      ) : null}
    </Wrapper>
  );
};

export default ThemeDropdown;
