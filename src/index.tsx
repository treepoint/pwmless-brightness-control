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
 * This project is derived from vibrantDeck (https://github.com/steam3d/MagicBlackDecky)
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

// Хелперы
const getOpacityValue = () => parseFloat(localStorage.getItem("pwmlessbrightness") ?? "0.5");
const getLutBrightnessValue = () => parseFloat(localStorage.getItem("pwmlessbrightness_lut") ?? "1.0");
const getPwmBrightnessPercent = () => 100 - getOpacityValue() * 100;
const getLutBrightnessPercent = () => getLutBrightnessValue() * 100;

// Глобальное состояние (доступно вне React)
let currentOverlayBrightnessPercent = getPwmBrightnessPercent(); // сохранённое значение
let isHDREnabledGlobal = false;
let serverAPIRef: ServerAPI | null = null;

const applyOverlayOpacity = () => {
  // Всегда передаём ПРОЦЕНТ, даже если HDR выключен
  const percent = isHDREnabledGlobal ? currentOverlayBrightnessPercent : 100;

  if (serverAPIRef) {
    serverAPIRef.routerHook.removeGlobalComponent("BlackOverlay");
    setTimeout(() => {
      serverAPIRef?.routerHook.addGlobalComponent(
        "BlackOverlay",
        (props) => <Overlay {...props} opacityPercent={percent} />
      );
    }, 10);
  }
};

// Фоновая проверка HDR (работает всегда, даже без открытого UI)
let hdrCheckInterval: NodeJS.Timeout | null = null;

const startHDRMonitoring = (serverAPI: ServerAPI) => {
  serverAPIRef = serverAPI;

  const checkHDR = async () => {
    try {
      const hdrStatus = await serverAPI.callPluginMethod("get_hdr_status", {});
      const newHDRStatus = hdrStatus.result;

      if (newHDRStatus !== isHDREnabledGlobal) {
        isHDREnabledGlobal = newHDRStatus;
        applyOverlayOpacity(); // обновляем оверлей при изменении HDR
      }
    } catch (error) {
      console.error("HDR check failed:", error);
    }
  };

  checkHDR(); // сразу проверить
  hdrCheckInterval = setInterval(checkHDR, 250);
};

const stopHDRMonitoring = () => {
  if (hdrCheckInterval) {
    clearInterval(hdrCheckInterval);
    hdrCheckInterval = null;
  }
  serverAPIRef = null;
};

// === Компонент настроек (только для UI) ===
const BrightnessSettings = ({ onOverlayChange, onLutChange }) => {
  const [savedOverlay, setSavedOverlay] = useState(currentOverlayBrightnessPercent);
  const [lut, setLut] = useState(getLutBrightnessPercent());

  // UI только отображает и редактирует savedOverlay
  const handleOverlayChange = (value: number) => {
    setSavedOverlay(value);
    currentOverlayBrightnessPercent = value;
    localStorage.setItem("pwmlessbrightness", ((100 - value) / 100).toString());
    // Если сейчас HDR включён — сразу применить
    if (isHDREnabledGlobal) {
      applyOverlayOpacity();
    }
    onOverlayChange?.(value);
  };

  const handleLutChange = (value: number) => {
    setLut(value);
    onLutChange(value);
  };

  return (
    <>
      <PanelSection title="General brightness (LUT)">
        <PanelSectionRow>
          <SliderField
            label="General brightness"
            value={lut}
            min={1}
            max={100}
            step={1}
            showValue
            onChange={handleLutChange}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="HDR Brightness (Overlay)">
        <PanelSectionRow>
          <SliderField
            label="HDR Brightness"
            value={savedOverlay}
            min={1}
            max={100}
            step={1}
            showValue
            onChange={handleOverlayChange}
            disabled={!isHDREnabledGlobal}
          />
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};

// === Плагин ===
export default definePlugin((serverAPI: ServerAPI) => {
  // --- LUT Brightness (оставим как debounce) ---
  let lutUpdateTimeout: NodeJS.Timeout | null = null;
  const updateLutBrightness = async (percent: number) => {
    const brightness = percent / 100;
    localStorage.setItem("pwmlessbrightness_lut", brightness.toString());
    if (lutUpdateTimeout) clearTimeout(lutUpdateTimeout);
    lutUpdateTimeout = setTimeout(async () => {
      try {
        await serverAPI.callPluginMethod("set_brightness", { brightness });
      } catch (error) {
        console.error("LUT brightness failed:", error);
      }
    }, 300);
  };

  // Активация
  (async () => {
    try {
      await serverAPI.callPluginMethod("activate", {});
    } catch (error) {
      console.error("Plugin activate failed:", error);
    }
  })();

  // Запуск HDR мониторинга — работает всегда!
  startHDRMonitoring(serverAPI);

  // Изначально добавим оверлей (возможно, HDR уже включён)
  applyOverlayOpacity();

  return {
    title: <div className={staticClasses.Title}>PWMless Brightness</div>,
    content: (
      <BrightnessSettings
        onOverlayChange={() => {}} // можно оставить пустым — всё управление глобальное
        onLutChange={updateLutBrightness}
      />
    ),
    icon: <FaEyeDropper />,
    // Очистка при выгрузке плагина
    onDismount() {
      stopHDRMonitoring();
      serverAPI.routerHook.removeGlobalComponent("BlackOverlay");
    },
  };
});