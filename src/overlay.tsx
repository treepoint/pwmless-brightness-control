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
  return Math.pow(t, 1.5);
};

const NEUTRAL_TEMP = 6500;
const BASE_TEMP_OPACITY = 0.001; // Минимальная прозрачность у нейтральной температуры
const MAX_TEMP_OPACITY = 0.215;   // Максимальная прозрачность при сильном отклонении

const WARM_INTENSITY_CURVE = 0.3; // Нелинейность для тёплых тонов (0.5 = корень, 1 = линейно, 2 = квадрат)
const COOL_INTENSITY_CURVE = 0.3; // Нелинейность для холодных тонов

// Простая функция: красный для тёплого, синий для холодного
function getSimpleTemperatureColor(kelvin: number, brightnessPercent: number): { rgb: [number, number, number], opacity: number } {
  if (kelvin === NEUTRAL_TEMP) {
    return { rgb: [0, 0, 0], opacity: 0 };
  }
  
  const diff = kelvin - NEUTRAL_TEMP;
  const maxDiff = 4000;
  const normalizedDiff = Math.min(1, Math.abs(diff) / maxDiff);
  
  let intensity: number;
  let baseOpacity: number;
  
  if (kelvin < NEUTRAL_TEMP) {
    // Тёплый
    intensity = Math.pow(normalizedDiff, WARM_INTENSITY_CURVE);
    baseOpacity = BASE_TEMP_OPACITY + (MAX_TEMP_OPACITY - BASE_TEMP_OPACITY) * intensity;
    
    const brightnessMultiplier = brightnessPercent / 100;
    const opacity = baseOpacity * brightnessMultiplier * intensity;
    
    return {
      rgb: [
        Math.round(255 * intensity),
        Math.round(175 * intensity),
        0
      ],
      opacity
    };
  } else {
    // Холодный
    intensity = Math.pow(normalizedDiff, COOL_INTENSITY_CURVE);
    baseOpacity = BASE_TEMP_OPACITY + (MAX_TEMP_OPACITY - BASE_TEMP_OPACITY) * intensity;
    
    const brightnessMultiplier = brightnessPercent / 100;
    const opacity = baseOpacity * brightnessMultiplier;
    
    return {
      rgb: [
        0,
        Math.round(50 * intensity),
        Math.round(255 * intensity)
      ],
      opacity
    };
  }
}

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
      if (temperatureKelvin === NEUTRAL_TEMP) {
        tempOverlayRef.current.style.backgroundColor = 'transparent';
      } else {
        const { rgb: [r, g, b], opacity } = getSimpleTemperatureColor(temperatureKelvin, opacityPercent);
        tempOverlayRef.current.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${opacity})`;
      }
    }

    isFirstRender.current = false;
  }, [opacityPercent, temperatureKelvin]);

  const initialOpacity = getSmoothOpacity(opacityPercent);
  
  let initialTempBg = 'transparent';
  if (temperatureKelvin !== NEUTRAL_TEMP) {
    const { rgb: [r, g, b], opacity } = getSimpleTemperatureColor(temperatureKelvin, opacityPercent);
    initialTempBg = `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

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
      {/* Температурный оверлей: просто полупрозрачный цвет */}
      <div
        ref={tempOverlayRef}
        id="temperature_overlay"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundColor: initialTempBg,
          zIndex: -1,
          pointerEvents: "none",
          transition: "background-color 0.3s ease-out",
        }}
      />
    </>
  );
};

export default Overlay;