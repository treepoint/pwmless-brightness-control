/*
 * PWMLess Brightness Control
 * Copyright (C) 2024 Daniel Stoynev
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *  * This project is derived from MagicBlackDecky (https://github.com/steam3d/MagicBlackDecky)
 * which is copyright (c) libvibrant and licensed under GNU General Public License v3.0.
 */

import { findModuleChild } from "decky-frontend-lib";
import { VFC, useRef, useEffect, memo } from "react";

enum UIComposition {
  Hidden = 0,
  Notification = 1,
  Overlay = 2,
  Opaque = 3,
  OverlayKeyboard = 4,
}

type UseUIComposition = (composition: UIComposition) => {
  releaseComposition: () => void;
};

const useUIComposition: UseUIComposition = findModuleChild((m) => {
  if (typeof m !== "object") return undefined;
  for (let prop in m) {
    if (
      typeof m[prop] === "function" &&
      m[prop].toString().includes("AddMinimumCompositionStateRequest") &&
      m[prop].toString().includes("ChangeMinimumCompositionStateRequest") &&
      m[prop].toString().includes("RemoveMinimumCompositionStateRequest") &&
      !m[prop].toString().includes("m_mapCompositionStateRequests")
    ) {
      return m[prop];
    }
  }
});

// КРИТИЧНО: UICompositionProxy вызывается ОДИН раз при монтировании, не пере-рендерится
const UICompositionProxy: VFC = memo(() => {
  useUIComposition(UIComposition.Notification);
  return null;
});

// Преобразует линейный процент (0–100) в перцептуально-гладкий opacity
const getSmoothOpacity = (percent: number): number => {
  if (percent >= 100) return 0;
  if (percent <= 0) return 0.997;

  const t = (100 - percent) / 100; // 0 → 1
  return Math.pow(t, 0.3);
};

interface OverlayProps {
  opacityPercent?: number; // 0–100, как в настройках
  backgroundColor?: string;
}

const Overlay: VFC<OverlayProps> = ({ opacityPercent = 50, backgroundColor = 'black' }) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  // Обновляем opacity через ref напрямую, избегая re-render
  useEffect(() => {
    if (overlayRef.current && !isFirstRender.current) {
      const smoothOpacity = getSmoothOpacity(opacityPercent);
      overlayRef.current.style.opacity = String(smoothOpacity);
    }
    isFirstRender.current = false;
  }, [opacityPercent]);

  // Начальная opacity
  const initialOpacity = getSmoothOpacity(opacityPercent);

  return (
    <>
      <UICompositionProxy />
      <div
        ref={overlayRef}
        id="brightness_bar_container"
        style={{
          left: 0,
          top: 0,
          width: "100vw",
          height: "100vh",
          background: backgroundColor,
          zIndex: -1,
          position: "fixed",
          opacity: initialOpacity,
          pointerEvents: "none",
          transition: "opacity 0.2s ease-out",
          willChange: "opacity",
        }}
      />
    </>
  );
};

export default Overlay;