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

import { useState } from "react";
import { FaEyeDropper } from "react-icons/fa";
import Overlay from "./overlay";

const getOpacityValue = () => {
  return parseFloat(localStorage.getItem("pwmlessbrightness") ?? "0.5")
}

const getLutBrightnessValue = () => {
  return parseFloat(localStorage.getItem("pwmlessbrightness_lut") ?? "1.0")
}

const getPwmBrightnessPercent = () => {
  return 100 - (getOpacityValue() * 100)
}

const getLutBrightnessPercent = () => {
  return getLutBrightnessValue() * 100
}

const BrightnessSettings = ({ 
  onOverlayBrightnessChange,
  onLutBrightnessChange
}) => {
  const [overlayBrightness, setOverlayBrightness] = useState(getPwmBrightnessPercent());
  const [lutBrightness, setLutBrightness] = useState(getLutBrightnessPercent());

  const updateOverlayBrightness = async (newBrightness: number) => {
    setOverlayBrightness(newBrightness);
    onOverlayBrightnessChange(newBrightness)
  };

  const updateLutBrightness = async (newBrightness: number) => {
    setLutBrightness(newBrightness);
    onLutBrightnessChange(newBrightness)
  };

  return (
    <>
      <PanelSection title="Brightness Overlay">
        <PanelSectionRow>
          <SliderField
            label="Overlay Brightness"
            value={overlayBrightness}
            min={0}
            max={100}
            step={1}
            showValue={true}
            onChange={updateOverlayBrightness}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="LUT Brightness">
        <PanelSectionRow>
          <SliderField
            label="Screen Brightness"
            value={lutBrightness}
            min={0}
            max={100}
            step={1}
            showValue={true}
            onChange={updateLutBrightness}
          />
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};

let pwmOpacity = getOpacityValue()
let lutBrightness = getLutBrightnessValue()
let overlayUpdateTimeout: NodeJS.Timeout | null = null;
let lutUpdateTimeout: NodeJS.Timeout | null = null;

export default definePlugin((serverAPI: ServerAPI) => {
  // Update overlay brightness
  const updateOverlayBrightness = (percent: number) => {
    pwmOpacity = (100 - percent) / 100
    localStorage.setItem("pwmlessbrightness", pwmOpacity.toString())
    
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

  // Update LUT brightness (Dimmer Deck style)
  const updateLutBrightness = async (percent: number) => {
    lutBrightness = percent / 100
    localStorage.setItem("pwmlessbrightness_lut", lutBrightness.toString())
    
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
    }, 100);
  };

  // Initialize plugin
  (async () => {
    try {
      await serverAPI.callPluginMethod("activate", {});
    } catch (error) {
      console.error("Failed to activate plugin:", error);
    }
  })();

  serverAPI.routerHook.addGlobalComponent("BlackOverlay", (props) => <Overlay {...props} opacity={pwmOpacity} />);

  return {
    title: <div className={staticClasses.Title}>PWMless Brightness</div>,
    content: <BrightnessSettings 
      onOverlayBrightnessChange={updateOverlayBrightness}
      onLutBrightnessChange={updateLutBrightness}
    />,
    icon: <FaEyeDropper />,
  };
});