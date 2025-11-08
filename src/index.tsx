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

// ============================================================================
// КОНСТАНТЫ И КЛЮЧИ ЛОКАЛЬНОГО ХРАНИЛИЩА
// ============================================================================

const STORAGE_KEYS = {
  OVERLAY_OPACITY: "pwmlessbrightness",      // Прозрачность оверлея (0-1)
  LUT_BRIGHTNESS: "pwmlessbrightness_lut",   // Яркость через LUT (0-1)
  VIBRANCY: "vibrancy_value",                // Насыщенность цветов (0-1)
  TEMPERATURE: "temperature_value",          // Цветовая температура (Kelvin)
};

const DEFAULT_VALUES = {
  OVERLAY_OPACITY: 0.5,    // 50% затемнения по умолчанию
  LUT_BRIGHTNESS: 1.0,     // 100% яркости по умолчанию
  VIBRANCY: 0.5,           // Нейтральная насыщенность
  TEMPERATURE: 9500,       // Холодная температура по умолчанию
};

const THROTTLE_MS = 100; // Минимальный интервал между обновлениями (10 раз/сек)
const HDR_CHECK_INTERVAL_MS = 250; // Проверка HDR каждые 250мс

// ============================================================================
// УТИЛИТЫ ДЛЯ РАБОТЫ С LOCALSTORAGE
// ============================================================================

/**
 * Получает значение прозрачности оверлея из localStorage
 * @returns число от 0 до 1, где 0 = полностью прозрачный, 1 = полностью чёрный
 */
const getOverlayOpacity = (): number => {
  return parseFloat(localStorage.getItem(STORAGE_KEYS.OVERLAY_OPACITY) ?? String(DEFAULT_VALUES.OVERLAY_OPACITY));
};

/**
 * Получает яркость LUT из localStorage
 * @returns число от 0 до 1, где 1 = полная яркость
 */
const getLutBrightness = (): number => {
  return parseFloat(localStorage.getItem(STORAGE_KEYS.LUT_BRIGHTNESS) ?? String(DEFAULT_VALUES.LUT_BRIGHTNESS));
};

/**
 * Конвертирует яркость LUT в проценты для UI
 * @returns число от 0 до 100
 */
const getLutBrightnessPercent = (): number => {
  return getLutBrightness() * 100;
};

/**
 * Конвертирует прозрачность оверлея в проценты яркости для UI
 * Инвертирует значение: высокая прозрачность = низкая яркость
 * @returns число от 0 до 100
 */
const getOverlayBrightnessPercent = (): number => {
  return 100 - getOverlayOpacity() * 100;
};

/**
 * Получает насыщенность цветов из localStorage
 * @returns число от 0 до 1
 */
const getVibrancy = (): number => {
  return parseFloat(localStorage.getItem(STORAGE_KEYS.VIBRANCY) ?? String(DEFAULT_VALUES.VIBRANCY));
};

/**
 * Получает цветовую температуру из localStorage
 * @returns температура в Кельвинах
 */
const getTemperature = (): number => {
  return parseFloat(localStorage.getItem(STORAGE_KEYS.TEMPERATURE) ?? String(DEFAULT_VALUES.TEMPERATURE));
};

// ============================================================================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ============================================================================
// Это состояние живёт вне React-компонентов и доступно всегда,
// даже когда UI закрыт. Это критично для фоновой работы HDR мониторинга.

/**
 * Текущее значение яркости оверлея (в процентах)
 * Синхронизируется с localStorage при изменениях
 */
let globalOverlayBrightnessPercent = getOverlayBrightnessPercent();

/**
 * Текущая цветовая температура
 * Используется для применения коррекции цвета
 */
let globalTemperature = getTemperature();

/**
 * Флаг состояния HDR
 * true = HDR включён, оверлей должен работать
 * false = SDR режим, оверлей скрыт (100% прозрачность)
 */
let isHDRActive = false;

/**
 * Callback для обновления React-компонента оверлея
 * Позволяет изменять прозрачность и температуру без пересоздания компонента
 */
let overlayUpdateCallback: ((percent: number, temperature: number) => void) | null = null;

/**
 * Callback для уведомления UI о смене HDR состояния
 * Обновляет метку "(Enabled/Disabled)" в интерфейсе
 */
let hdrStateUpdateCallback: ((isEnabled: boolean) => void) | null = null;

// ============================================================================
// УПРАВЛЕНИЕ ОВЕРЛЕЕМ
// ============================================================================

/**
 * Применяет текущие настройки яркости к оверлею
 * 
 * Логика работы:
 * - Если HDR выключен: оверлей полностью прозрачен (100%)
 * - Если HDR включён: применяется сохранённая яркость минус компенсация прозрачности
 * 
 * Компенсация нужна, чтобы оверлей работал корректно с учётом его базовой прозрачности
 */
const applyOverlaySettings = () => {
  // Если HDR выключен, оверлей должен быть невидимым
  const targetPercent = isHDRActive ? globalOverlayBrightnessPercent : 100;
  
  // Компенсируем базовую прозрачность оверлея
  const compensatedPercent = targetPercent - getOverlayOpacity();

  // Если есть активный callback, обновляем оверлей
  if (overlayUpdateCallback) {
    overlayUpdateCallback(compensatedPercent, globalTemperature);
  }
};

// ============================================================================
// ФОНОВЫЙ МОНИТОРИНГ HDR
// ============================================================================
// HDR мониторинг работает постоянно в фоне, проверяя каждые 250мс,
// включён ли HDR режим. Это нужно, потому что Steam Deck может переключаться
// между SDR и HDR автоматически при запуске игр.

let hdrCheckInterval: NodeJS.Timeout | null = null;
let serverAPIReference: ServerAPI | null = null;

/**
 * Запускает фоновую проверку состояния HDR
 * Проверяет каждые 250мс через вызов серверного метода
 * 
 * @param serverAPI - API для связи с бэкенд-частью плагина
 */
const startHDRMonitoring = (serverAPI: ServerAPI) => {
  serverAPIReference = serverAPI;

  /**
   * Функция проверки HDR, вызывается периодически
   */
  const checkHDRStatus = async () => {
    try {
      // Вызываем метод бэкенда для проверки HDR
      const response = await serverAPI.callPluginMethod("get_hdr_status", {});
      const newHDRStatus = response.result as boolean;

      // Если состояние HDR изменилось
      if (newHDRStatus !== isHDRActive) {
        isHDRActive = newHDRStatus;
        
        // Применяем новые настройки оверлея
        applyOverlaySettings();
        
        // Уведомляем UI об изменении (обновляет метку Enabled/Disabled)
        if (hdrStateUpdateCallback) {
          hdrStateUpdateCallback(newHDRStatus);
        }
      }
    } catch (error) {
      console.error("HDR status check failed:", error);
    }
  };

  // Проверяем сразу при старте
  checkHDRStatus();
  
  // Запускаем периодическую проверку
  hdrCheckInterval = setInterval(checkHDRStatus, HDR_CHECK_INTERVAL_MS);
};

/**
 * Останавливает фоновый мониторинг HDR
 * Вызывается при выгрузке плагина
 */
const stopHDRMonitoring = () => {
  if (hdrCheckInterval) {
    clearInterval(hdrCheckInterval);
    hdrCheckInterval = null;
  }
  serverAPIReference = null;
};

// ============================================================================
// REACT КОМПОНЕНТЫ
// ============================================================================

/**
 * Обёртка для компонента Overlay
 * 
 * Этот компонент живёт постоянно (добавлен как GlobalComponent) и никогда
 * не удаляется из DOM. Вместо удаления/добавления он обновляется через
 * React state, что предотвращает мерцание и проблемы с производительностью.
 */
const OverlayWrapper = () => {
  // Состояние прозрачности оверлея (в процентах)
  const [opacityPercent, setOpacityPercent] = useState(
    isHDRActive ? globalOverlayBrightnessPercent : 100
  );

  // Состояние цветовой температуры
  const [temperature, setTemperature] = useState(globalTemperature);

  useEffect(() => {
    // Регистрируем callback для внешнего обновления состояния
    // Это позволяет изменять оверлей из любого места кода
    overlayUpdateCallback = (percent: number, temp: number) => {
      setOpacityPercent(percent);
      setTemperature(temp);
    };

    // Очищаем callback при размонтировании
    return () => {
      overlayUpdateCallback = null;
    };
  }, []);

  return <Overlay opacityPercent={opacityPercent} temperatureKelvin={temperature} />;
};

// ============================================================================
// ИНТЕРФЕЙС НАСТРОЕК
// ============================================================================

interface BrightnessSettingsProps {
  onOverlayChange: (percent: number) => void;
  onLutChange: (percent: number) => void;
  onVibrancyChange: (value: number) => void;
  onTemperatureChange: (kelvin: number) => void;
}

/**
 * Компонент панели настроек яркости и цвета
 * 
 * Содержит два раздела:
 * 1. Brightness - управление яркостью через LUT и оверлей
 * 2. Color correction - управление температурой и насыщенностью
 */
const BrightnessSettings = ({
  onOverlayChange,
  onLutChange,
  onVibrancyChange,
  onTemperatureChange,
}: BrightnessSettingsProps) => {
  // Локальное состояние для UI слайдеров
  const [overlayPercent, setOverlayPercent] = useState(globalOverlayBrightnessPercent);
  const [lutPercent, setLutPercent] = useState(getLutBrightnessPercent());
  const [vibrancy, setVibrancy] = useState(getVibrancy());
  const [temperature, setTemperature] = useState(getTemperature());
  const [isHDREnabled, setIsHDREnabled] = useState(isHDRActive);

  // Подписываемся на изменения HDR состояния
  useEffect(() => {
    hdrStateUpdateCallback = (isEnabled: boolean) => {
      setIsHDREnabled(isEnabled);
    };

    return () => {
      hdrStateUpdateCallback = null;
    };
  }, []);

  /**
   * Обработчик изменения яркости оверлея
   * Сохраняет в localStorage и применяет, если HDR активен
   */
  const handleOverlayChange = (value: number) => {
    setOverlayPercent(value);
    globalOverlayBrightnessPercent = value;
    
    // Конвертируем проценты яркости в прозрачность (инвертируем)
    const opacity = (100 - value) / 100;
    localStorage.setItem(STORAGE_KEYS.OVERLAY_OPACITY, opacity.toString());

    // Применяем только если HDR включён
    if (isHDRActive) {
      applyOverlaySettings();
    }
    
    onOverlayChange(value);
  };

  /**
   * Обработчик изменения яркости LUT
   */
  const handleLutChange = (value: number) => {
    setLutPercent(value);
    onLutChange(value);
  };

  /**
   * Обработчик изменения насыщенности
   */
  const handleVibrancyChange = (value: number) => {
    setVibrancy(value);
    onVibrancyChange(value);
  };

  /**
   * Обработчик изменения цветовой температуры
   * Сохраняет в localStorage и глобальное состояние, применяет если HDR активен
   */
  const handleTemperatureChange = (value: number) => {
    setTemperature(value);
    localStorage.setItem(STORAGE_KEYS.TEMPERATURE, value.toString());
    globalTemperature = value;

    // Применяем только если HDR включён
    if (isHDRActive) {
      applyOverlaySettings();
    }
    
    onTemperatureChange(value);
  };

  return (
    <>
      <PanelSection title="Brightness">
        <PanelSectionRow>
          <SliderField
            label="General brightness"
            description="Works for SDR content and UI."
            value={lutPercent}
            step={1}
            min={10}
            max={100}
            showValue
            onChange={handleLutChange}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <SliderField
            label={`HDR Brightness (${isHDREnabled ? 'Enabled' : 'Disabled'})`}
            description="Works only for HDR content."
            value={overlayPercent}
            min={5}
            max={100}
            step={1}
            showValue
            onChange={handleOverlayChange}
          />
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title="Color correction">
        <PanelSectionRow>
          <SliderField
            label="Temperature"
            description="Low to warmer color and high for cooler. 6500 — no correction."
            value={temperature}
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
            description="Control the vibrancy. Works for some games. 0.5 - no correction."
            value={vibrancy}
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

// ============================================================================
// ОПРЕДЕЛЕНИЕ ПЛАГИНА
// ============================================================================

export default definePlugin((serverAPI: ServerAPI) => {
  // ========================================================================
  // THROTTLED ФУНКЦИИ ДЛЯ ОБНОВЛЕНИЯ НАСТРОЕК
  // ========================================================================
  // Эти функции ограничивают частоту вызовов API (не чаще 10 раз/сек),
  // чтобы не перегружать бэкенд при быстром движении слайдеров.

  let canUpdateLut = true;
  let canUpdateVibrancy = true;
  let canUpdateTemperature = true;

  /**
   * Обновляет яркость LUT на сервере
   * Throttled: не чаще 10 раз в секунду
   * 
   * @param percent - яркость в процентах (0-100)
   */
  const updateLutBrightness = async (percent: number) => {
    const brightness = percent / 100;
    localStorage.setItem(STORAGE_KEYS.LUT_BRIGHTNESS, brightness.toString());

    if (!canUpdateLut) return;

    canUpdateLut = false;
    try {
      await serverAPI.callPluginMethod("set_brightness_and_temperature", {
        brightness,
        temperature_kelvin: getTemperature(),
      });
    } catch (error) {
      console.error("LUT brightness update failed:", error);
    } finally {
      setTimeout(() => {
        canUpdateLut = true;
      }, THROTTLE_MS);
    }
  };

  /**
   * Обновляет насыщенность на сервере
   * Throttled: не чаще 10 раз в секунду
   * 
   * @param value - насыщенность (0-1)
   */
  const updateVibrancy = async (value: number) => {
    localStorage.setItem(STORAGE_KEYS.VIBRANCY, value.toString());

    if (!canUpdateVibrancy) return;

    canUpdateVibrancy = false;
    try {
      await serverAPI.callPluginMethod("set_vibrancy", { vibrancy: value });
    } catch (error) {
      console.error("Vibrancy update failed:", error);
    } finally {
      setTimeout(() => {
        canUpdateVibrancy = true;
      }, THROTTLE_MS);
    }
  };

  /**
   * Обновляет цветовую температуру на сервере
   * Throttled: не чаще 10 раз в секунду
   * 
   * @param value - температура в Кельвинах
   */
  const updateTemperature = async (value: number) => {
    globalTemperature = value;
    localStorage.setItem(STORAGE_KEYS.TEMPERATURE, value.toString());

    if (!canUpdateTemperature) return;

    canUpdateTemperature = false;
    try {
      await serverAPI.callPluginMethod("set_brightness_and_temperature", {
        brightness: getLutBrightness(),
        temperature_kelvin: value,
      });
    } catch (error) {
      console.error("Temperature update failed:", error);
    } finally {
      setTimeout(() => {
        canUpdateTemperature = true;
      }, THROTTLE_MS);
    }
  };

  // ========================================================================
  // ИНИЦИАЛИЗАЦИЯ ПЛАГИНА
  // ========================================================================

  /**
   * Активируем плагин на бэкенде
   * Выполняется асинхронно при загрузке
   */
  (async () => {
    try {
      await serverAPI.callPluginMethod("activate", {});
    } catch (error) {
      console.error("Plugin activation failed:", error);
    }
  })();

  /**
   * Запускаем фоновый мониторинг HDR
   * Работает постоянно, даже когда UI закрыт
   */
  startHDRMonitoring(serverAPI);

  /**
   * КРИТИЧНО: Добавляем оверлей как глобальный компонент ОДИН РАЗ
   * Он будет жить постоянно и обновляться через React state,
   * а не через удаление/добавление в DOM
   */
  serverAPI.routerHook.addGlobalComponent("BlackOverlay", OverlayWrapper);

  // ========================================================================
  // ВОЗВРАЩАЕМЫЙ ОБЪЕКТ ПЛАГИНА
  // ========================================================================
  
  return {
    // Заголовок плагина в меню
    title: <div className={staticClasses.Title}>Dark Sight</div>,
    
    // Содержимое панели настроек
    content: (
      <BrightnessSettings
        onOverlayChange={() => {}} // Обработка уже внутри компонента
        onLutChange={updateLutBrightness}
        onVibrancyChange={updateVibrancy}
        onTemperatureChange={updateTemperature}
      />
    ),
    
    // Иконка плагина
    icon: <FaEyeDropper />,
    
    /**
     * Вызывается при выгрузке плагина
     * Останавливает мониторинг, сбрасывает насыщенность, удаляет оверлей
     */
    onDismount() {
      stopHDRMonitoring();
      
      // Сбрасываем насыщенность в нейтральное значение
      updateVibrancy(DEFAULT_VALUES.VIBRANCY);
      
      // Удаляем глобальный компонент оверлея
      serverAPI.routerHook.removeGlobalComponent("BlackOverlay");
    },
  };
});