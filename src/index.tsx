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
 * This project is derived from vibrantDeck (https://github.com/libvibrant/vibrantDeck)
 * which is copyright (c) libvibrant and licensed under GNU General Public License v3.0.
 */

import {
  definePlugin,
  PanelSection,
  PanelSectionRow,
  SliderField,
  ServerAPI,
  staticClasses,
} from "decky-frontend-lib";

import { useState, useEffect } from "react";
import { FaEyeDropper } from "react-icons/fa";
import Overlay from "./overlay";

const getOpacityValue = () => {
  return parseFloat(localStorage.getItem("pwmlessbrightness") ?? "0.5");
};

const getLutBrightnessValue = () => {
  return parseFloat(localStorage.getItem("pwmlessbrightness_lut") ?? "1.0");
};

const getPwmBrightnessPercent = () => {
  return 100 - getOpacityValue() * 100;
};

const getLutBrightnessPercent = () => {
  return getLutBrightnessValue() * 100;
};

const BrightnessSettings = ({ 
  onOverlayBrightnessChange,
  onLutBrightnessChange,
  serverAPI,
}) => {
  const [savedOverlayBrightness, setSavedOverlayBrightness] = useState(getPwmBrightnessPercent());
  const [lutBrightness, setLutBrightness] = useState(getLutBrightnessPercent());
  const [isHDREnabled, setIsHDREnabled] = useState(false);

  // Проверяем HDR каждые 250 мс
  useEffect(() => {
    const checkHDR = async () => {
      try {
        const hdrStatus = await serverAPI.callPluginMethod("get_hdr_status", {});
        setIsHDREnabled(hdrStatus.result);
      } catch (error) {
        console.error("Failed to check HDR status:", error);
      }
    };

    checkHDR();
    const interval = setInterval(checkHDR, 250);
    return () => clearInterval(interval);
  }, [serverAPI]);

  // Применяем яркость: сохранённую — если HDR включён, иначе 100 (прозрачный оверлей)
  useEffect(() => {
    if (isHDREnabled) {
      onOverlayBrightnessChange(savedOverlayBrightness);
    } else {
      onOverlayBrightnessChange(100); // оверлей выключен
    }
  }, [isHDREnabled, savedOverlayBrightness, onOverlayBrightnessChange]);

  const handleOverlayChange = (value: number) => {
    setSavedOverlayBrightness(value);
    // Сохраняем в localStorage сразу (опционально, но логично)
    localStorage.setItem("pwmlessbrightness", ((100 - value) / 100).toString());
    if (isHDREnabled) {
      onOverlayBrightnessChange(value);
    }
  };

  const handleLutChange = (value: number) => {
    setLutBrightness(value);
    onLutBrightnessChange(value);
  };

  return (
    <>
      <PanelSection title="General brightness (LUT)">
        <PanelSectionRow>
          <SliderField
            label="General brightness"
            value={lutBrightness}
            min={0}
            max={100}
            step={1}
            showValue={true}
            onChange={handleLutChange}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title={`HDR Brightness (Overlay) ${isHDREnabled ? "✓" : "✗"}`}>
        <PanelSectionRow>
          <SliderField
            label="HDR Brightness"
            value={savedOverlayBrightness}
            min={0}
            max={100}
            step={1}
            showValue={true}
            onChange={handleOverlayChange}
            disabled={!isHDREnabled}
          />
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};

// Глобальные переменные для debounce
let pwmOpacity = getOpacityValue();
let lutBrightness = getLutBrightnessValue();
let overlayUpdateTimeout: NodeJS.Timeout | null = null;
let lutUpdateTimeout: NodeJS.Timeout | null = null;

export default definePlugin((serverAPI: ServerAPI) => {
  const updateOverlayBrightness = (percent: number) => {
    // Всегда обновляем глобальную переменную (даже если 100)
    pwmOpacity = (100 - percent) / 100;

    if (overlayUpdateTimeout) {
      clearTimeout(overlayUpdateTimeout);
    }

    overlayUpdateTimeout = setTimeout(() => {
      serverAPI.routerHook.removeGlobalComponent("BlackOverlay");
      setTimeout(() => {
        serverAPI.routerHook.addGlobalComponent(
          "BlackOverlay",
          (props) => <Overlay {...props} opacity={pwmOpacity} />
        );
      }, 10);
    }, 200);
  };

  const updateLutBrightness = async (percent: number) => {
    lutBrightness = percent / 100;
    localStorage.setItem("pwmlessbrightness_lut", lutBrightness.toString());

    if (lutUpdateTimeout) {
      clearTimeout(lutUpdateTimeout);
    }

    lutUpdateTimeout = setTimeout(async () => {
      try {
        await serverAPI.callPluginMethod("set_brightness", {
          brightness: lutBrightness,
        });
      } catch (error) {
        console.error("Failed to set LUT brightness:", error);
      }
    }, 300);
  };

  // Активация плагина
  (async () => {
    try {
      await serverAPI.callPluginMethod("activate", {});
    } catch (error) {
      console.error("Failed to activate plugin:", error);
    }
  })();

  // Изначально добавляем оверлей (на случай, если HDR уже включён)
  serverAPI.routerHook.addGlobalComponent("BlackOverlay", (props) => (
    <Overlay {...props} opacity={pwmOpacity} />
  ));

  return {
    title: <div className={staticClasses.Title}>PWMless Brightness</div>,
    content: (
      <BrightnessSettings
        onOverlayBrightnessChange={updateOverlayBrightness}
        onLutBrightnessChange={updateLutBrightness}
        serverAPI={serverAPI}
      />
    ),
    icon: <FaEyeDropper />,
  };
});