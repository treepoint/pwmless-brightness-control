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
const getLutBrightnessPercent = () => getLutBrightnessValue() * 100;
const getPwmBrightnessPercent = () => 100 - getOpacityValue() * 100;
const getVibrancyValue = () => parseFloat(localStorage.getItem("vibrancy_value") ?? "0.5");
const getTemperatureValue = () => parseFloat(localStorage.getItem("temperature_value") ?? "9500");

// Глобальное состояние (доступно вне React)
let currentOverlayBrightnessPercent = getPwmBrightnessPercent();
let currentTemperatureGlobal = getTemperatureValue();
let isHDREnabledGlobal = false;
let overlayUpdateCallback: ((percent: number, temperature: number) => void) | null = null;

// КРИТИЧНО: вместо remove/add просто обновляем процент через callback
const applyOverlayOpacity = () => {
  const percent = isHDREnabledGlobal ? currentOverlayBrightnessPercent : 100;
  const percent_compensate = percent - getOpacityValue()

  if (overlayUpdateCallback) {
    overlayUpdateCallback(percent_compensate, currentTemperatureGlobal);
  }
};

// Фоновая проверка HDR (работает всегда, даже без открытого UI)
let hdrCheckInterval: NodeJS.Timeout | null = null;
let serverAPIRef: ServerAPI | null = null;

const startHDRMonitoring = (serverAPI: ServerAPI) => {
  serverAPIRef = serverAPI;

  const checkHDR = async () => {
    try {
      const hdrStatus = await serverAPI.callPluginMethod("get_hdr_status", {});
      const newHDRStatus = hdrStatus.result;

      if (newHDRStatus !== isHDREnabledGlobal) {
        isHDREnabledGlobal = newHDRStatus;
        applyOverlayOpacity();
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

// Враппер который живёт постоянно и обновляется через состояние
const OverlayWrapper = () => {
  const [opacityPercent, setOpacityPercent] = useState(
    isHDREnabledGlobal ? currentOverlayBrightnessPercent : 100
  );

  const [temperature, setTemperature] = useState(currentTemperatureGlobal);

  useEffect(() => {
    // Регистрируем callback для обновления
    overlayUpdateCallback = (percent: number, temperature: number) => {
      setOpacityPercent(percent);
      setTemperature(temperature);
    };

    return () => {
      overlayUpdateCallback = null;
    };
  }, []);

  return <Overlay opacityPercent={opacityPercent} temperatureKelvin={temperature}/>;
};

// === Компонент настроек (только для UI) ===
const BrightnessSettings = ({ onOverlayChange, onLutChange, onVibrancyChange, onTemperatureChange }) => {
  const [savedOverlayPercent, setSavedOverlayPercent] = useState(currentOverlayBrightnessPercent);
  const [lutValue, setLutValue] = useState(getLutBrightnessPercent());
  const [currentTargetVibrancy, setCurrentTargetVibrancy] = useState(getVibrancyValue());
  const [currentTargetTemperature, setCurrentTargetTemperature] = useState(getTemperatureValue());
  const [isHDREnabled, setIsHDREnabled] = useState(isHDREnabledGlobal);

  const handleOverlayChange = (value: number) => {
    setSavedOverlayPercent(value);
    currentOverlayBrightnessPercent = value;
    localStorage.setItem("pwmlessbrightness", ((100 - value) / 100).toString());

    // Если сейчас HDR включён — сразу применить
    if (isHDREnabledGlobal) {
      applyOverlayOpacity();
    }
    onOverlayChange?.(value);
  };

  const handleLutChange = (value: number) => {
    setLutValue(value);
    onLutChange(value);
  };

  const handleVibrancyChange = (value: number) => {
    setCurrentTargetVibrancy(value);
    onVibrancyChange(value);
  };

  const handleTemperatureChange = (value: number) => {
    setCurrentTargetTemperature(value);
    onTemperatureChange(value);
    localStorage.setItem("temperature_value", value.toString());

    currentTemperatureGlobal = value;

    if (isHDREnabledGlobal) {
      applyOverlayOpacity();
    }
    onTemperatureChange?.(value);
  };

  useEffect(() => {
    setIsHDREnabled(isHDREnabledGlobal);
  }, [isHDREnabledGlobal]);

  return (
    <>
      <PanelSection title="Brightness">
        <PanelSectionRow>
          <SliderField
            label="General brightness (LUT)"
            description="Works for SDR content and UI"
            value={lutValue}
            step={1}
            min={10}
            max={100}
            showValue
            onChange={handleLutChange}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField
            label="HDR Brightness (Overlay)"
            description="Works only for HDR content"
            value={savedOverlayPercent}
            min={5}
            max={100}
            step={1}
            showValue
            onChange={handleOverlayChange}
            disabled={!isHDREnabled}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Color correction">
        <PanelSectionRow>
          <SliderField
            label="Temperature"
            description="Low to warmer color and high for cooler. 6500 — no correction."
            value={currentTargetTemperature}
            step={100}
            min={3500}
            max={9000}
            showValue
            onChange={handleTemperatureChange}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField
            label="Vibrancy"
            description="Control the vibrancy. Works for some games."
            value={currentTargetVibrancy}
            step={0.1}
            min={0}
            max={1}
            showValue
            onChange={handleVibrancyChange}
          />
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};

// === Плагин ===
export default definePlugin((serverAPI: ServerAPI) => {
  let lutUpdateTimeout: NodeJS.Timeout | null = null;
  let vibrancyUpdateTimeout: NodeJS.Timeout | null = null;
  let temperatureUpdateTimeout: NodeJS.Timeout | null = null;

  const updateLutBrightness = async (percent: number) => {
    const brightness = percent / 100;
    localStorage.setItem("pwmlessbrightness_lut", brightness.toString());

    if (lutUpdateTimeout) clearTimeout(lutUpdateTimeout);
    lutUpdateTimeout = setTimeout(async () => {
      try {
        await serverAPI.callPluginMethod("set_brightness_and_temperature", 
          { 
            brightness: brightness, 
            temperature_kelvin: getTemperatureValue()
          });
      } catch (error) {
        console.error("LUT brightness failed:", error);
      }
    }, 300);
  };

  const updateVibrancy = async (value: number) => {
    const vibrancy = value;
    localStorage.setItem("vibrancy_value", vibrancy.toString());

    if (vibrancyUpdateTimeout) clearTimeout(vibrancyUpdateTimeout);
    vibrancyUpdateTimeout = setTimeout(async () => {
      try {
        await serverAPI.callPluginMethod("set_vibrancy", { vibrancy });
      } catch (error) {
        console.error("Vibrancy failed:", error);
      }
    }, 300);
  };

  const updateTemperature = async (value: number) => {
    const temperature = value;
    currentTemperatureGlobal = value; 

    localStorage.setItem("temperature_value", temperature.toString());

    if (temperatureUpdateTimeout) clearTimeout(temperatureUpdateTimeout);
    temperatureUpdateTimeout = setTimeout(async () => {
      try {
        await serverAPI.callPluginMethod("set_brightness_and_temperature", 
          { 
            brightness: getLutBrightnessValue(), 
            temperature_kelvin: temperature 
          });
      } catch (error) {
        console.error("Temperature failed:", error);
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

  // КРИТИЧНО: добавляем overlay ОДИН РАЗ через wrapper
  serverAPI.routerHook.addGlobalComponent("BlackOverlay", OverlayWrapper);

  return {
    title: <div className={staticClasses.Title}>Dark Sight</div>,
    content: (
      <BrightnessSettings
        onOverlayChange={() => {}}
        onLutChange={updateLutBrightness}
        onVibrancyChange={updateVibrancy}
        onTemperatureChange={updateTemperature}
      />
    ),
    icon: <FaEyeDropper />,
    onDismount() {
      stopHDRMonitoring();
      updateVibrancy(0.5);
      serverAPI.routerHook.removeGlobalComponent("BlackOverlay");
    },
  };
});