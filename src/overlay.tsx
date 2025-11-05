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
 *
 * This project is derived from MagicBlackDecky (https://github.com/steam3d/MagicBlackDecky)
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

const UICompositionProxy: VFC = memo(() => {
  useUIComposition(UIComposition.Notification);
  return null;
});

const getSmoothOpacity = (percent: number): number => {
  if (percent >= 100) return 0;
  if (percent <= 0) return 0.997;
  const t = (100 - percent) / 100;
  return Math.pow(t, 0.3);
};

function kelvinToRGB(kelvin: number): [number, number, number] {
  const k = Math.max(1000, Math.min(15000, kelvin)) / 100;
  let r: number, g: number, b: number;

  if (k <= 66) {
    r = 255;
  } else {
    r = k - 60;
    r = 329.698727446 * Math.pow(r, -0.1332047592);
    r = Math.max(0, Math.min(255, r));
  }

  if (k <= 66) {
    g = k;
    g = 99.4708025861 * Math.pow(g, 0.34657359028) - 161.1195681661;
  } else {
    g = k - 60;
    g = 288.1221695283 * Math.pow(g, -0.0755148492);
  }
  g = Math.max(0, Math.min(255, g));

  if (k >= 66) {
    b = 255;
  } else if (k <= 19) {
    b = 0;
  } else {
    b = k - 10;
    b = 138.5177312231 * Math.pow(b, 0.3385599327) - 305.0447927307;
    b = Math.max(0, Math.min(255, b));
  }

  return [Math.round(r), Math.round(g), Math.round(b)];
}

const TEMP_OPACITY = 0.20; // Базовая прозрачность температурного слоя

interface OverlayProps {
  opacityPercent?: number;
  temperatureKelvin?: number;
}

const Overlay: VFC<OverlayProps> = ({ 
  opacityPercent = 50, 
  temperatureKelvin = 6500 
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const tempOverlayRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Обновляем основной чёрный оверлей (яркость)
    if (overlayRef.current && !isFirstRender.current) {
      const smoothOpacity = getSmoothOpacity(opacityPercent);
      overlayRef.current.style.opacity = String(smoothOpacity);
    }

    // Обновляем температурный слой
    if (tempOverlayRef.current) {
      const [r, g, b] = kelvinToRGB(temperatureKelvin);
      tempOverlayRef.current.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${TEMP_OPACITY})`;
    }

    isFirstRender.current = false;
  }, [opacityPercent, temperatureKelvin]);

  const initialOpacity = getSmoothOpacity(opacityPercent);
  const [r, g, b] = kelvinToRGB(temperatureKelvin);

  return (
    <>
      <UICompositionProxy />
      {/* Основной оверлей: затемнение */}
      <div
        ref={overlayRef}
        id="brightness_bar_container"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundColor: "black",
          opacity: initialOpacity,
          zIndex: -1,
          pointerEvents: "none",
          transition: "opacity 0.2s ease-out",
        }}
      />
      {/* Температурный оверлей: цветной оттенок */}
      <div
        ref={tempOverlayRef}
        id="temperature_overlay"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundColor: `rgba(${r}, ${g}, ${b}, ${TEMP_OPACITY})`,
          mixBlendMode: "color",
          zIndex: -1,
          pointerEvents: "none",
          transition: "background-color 0.3s ease-out",
        }}
      />
    </>
  );
};

export default Overlay;