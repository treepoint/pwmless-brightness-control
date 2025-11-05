import os
import sys
import struct
import subprocess
from typing import Any, List, Iterable

import decky
import decky_plugin

LUT1D_SIZE = 4096
LUT3D_SIZE = 17

def float_to_long(x: float) -> int:
    return struct.unpack("!I", struct.pack("!f", x))[0]


def long_to_float(x: int) -> float:
    return struct.unpack("!f", struct.pack("!I", x))[0]

def get_steam_displays() -> List[str]:
    displays = []
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                if not f.read().split(b"\0")[0].endswith(b"steam"):
                    continue
                decky_plugin.logger.info(f"Found steam process: {pid}")
            with open(f"/proc/{pid}/environ", "rb") as f:
                for line in f.read().split(b"\0"):
                    if not line.startswith(b"DISPLAY="):
                        continue
                    display = line.split(b"=")[1].decode()
                    if display not in displays:
                        displays.append(display)
                    decky_plugin.logger.info(f"Found steam display: {display}")
        except:
            pass
    return displays

def quantize(x: float) -> int:
    return int(round(x * 65535))

def generate_lut1d(output: str, brightness: float, temperature_kelvin: float = 6500.0):
    decky_plugin.logger.info(f"Generating LUT1D: brightness={brightness}, temp={temperature_kelvin}K")

    if not (0 <= brightness <= 1):
        raise ValueError("Brightness must be between 0 and 1")
    if not (1000 <= temperature_kelvin <= 15000):
        raise ValueError("Temperature must be between 1000K and 15000K")

    r_mult, g_mult, b_mult = kelvin_to_rgb_factors(temperature_kelvin)

    try:
        with open(output, "wb") as f:
            for x in range(LUT1D_SIZE):
                unit_val = x / (LUT1D_SIZE - 1)
                r_val = unit_val * brightness * r_mult
                g_val = unit_val * brightness * g_mult
                b_val = unit_val * brightness * b_mult

                bs = struct.pack(
                    "<HHHH",
                    quantize(r_val),
                    quantize(g_val),
                    quantize(b_val),
                    0,
                )
                f.write(bs)
        decky_plugin.logger.info(f"LUT1D generated successfully at {output}")
    except Exception as e:
        decky_plugin.logger.error(f"Failed to generate LUT1D: {e}")
        raise

def generate_lut3d(output: str, brightness: float):
    if brightness < 0 or brightness > 1:
        decky_plugin.logger.info("Invalid brightness")
        raise ValueError("Brightness must be between 0 and 1")
    to_unit = lambda i: i / (LUT3D_SIZE - 1) * brightness
    with open(output, "wb") as f:
        for b in range(LUT3D_SIZE):
            for g in range(LUT3D_SIZE):
                for r in range(LUT3D_SIZE):
                    bs = struct.pack(
                        "<HHHH",
                        quantize(to_unit(r)),
                        quantize(to_unit(g)),
                        quantize(to_unit(b)),
                        0,
                    )
                    f.write(bs)

    decky_plugin.logger.info(f"generate_lut3d is done")

def set_xprop(display: str, prop_name: str, prop_type: str, prop_value: Any):
    decky_plugin.logger.info(f"Setting xprop: display={display}, prop={prop_name}, value={prop_value}")
    cmd = [
        "xprop",
        "-root",
        "-d",
        display,
        "-f",
        prop_name,
        prop_type,
        "-set",
        prop_name,
        str(prop_value),
    ]
    ret = subprocess.call(cmd)

    if ret != 0:
        decky_plugin.logger.error(f"Failed to set xprop, cmd: {cmd}, return code: {ret}")
        raise Exception("Failed to set xprop")
    else:
        decky_plugin.logger.info(f"xprop set successfully")

def remove_xprop(display: str, prop_name: str):
    cmd = [
        "xprop",
        "-root",
        "-d",
        display,
        "-remove",
        prop_name,
    ]
    ret = subprocess.call(cmd)
    if ret != 0:
        decky_plugin.logger.info(f"Failed to set xprop, cmd: {cmd}")
        raise Exception("Failed to set xprop")

lut3d_path = os.path.abspath(
    os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "dim.lut3d")
)

lut1d_path = os.path.abspath(
    os.path.join(decky.DECKY_PLUGIN_RUNTIME_DIR, "dim.lut1d")
)

def kelvin_to_rgb_factors(kelvin: float) -> tuple[float, float, float]:
    """
    Convert color temperature in Kelvin to normalized RGB scaling factors.
    Valid range: ~1000K to 15000K (clamped).
    Returns (r, g, b) where max(r,g,b) == 1.0
    """
    # Clamp to reasonable range
    k = max(1000.0, min(15000.0, float(kelvin)))

    # Use algorithm from Tanner Helland (accurate approximation)
    temp = k / 100.0

    # Red
    if temp <= 66:
        r = 255.0
    else:
        r = temp - 60
        r = 329.698727446 * (r ** -0.1332047592)
        r = max(0, min(255, r))

    # Green
    if temp <= 66:
        g = temp
        g = 99.4708025861 * (g ** 0.34657359028) - 161.1195681661
    else:
        g = temp - 60
        g = 288.1221695283 * (g ** -0.0755148492)
    g = max(0, min(255, g))

    # Blue
    if temp >= 66:
        b = 255.0
    elif temp <= 19:
        b = 0.0
    else:
        b = temp - 10
        b = 138.5177312231 * (b ** 0.3385599327) - 305.0447927307
        b = max(0, min(255, b))

    # Convert to 0..1
    r_norm = r / 255.0
    g_norm = g / 255.0
    b_norm = b / 255.0

    # Normalize so that the brightest channel is 1.0 (avoid global brightening)
    max_val = max(r_norm, g_norm, b_norm)
    if max_val > 0:
        r_norm /= max_val
        g_norm /= max_val
        b_norm /= max_val

    return r_norm, g_norm, b_norm

class Plugin:
    async def activate(self):
        decky_plugin.logger.info("Activating")
        self.displays = get_steam_displays()
        self.first_run = True
        generate_lut3d(lut3d_path, 1.0)
        decky_plugin.logger.info(f"Found steam displays: {self.displays}")

    async def set_brightness_and_temperature(self, brightness: float, temperature_kelvin: float = 6500.0):
        decky_plugin.logger.info(f"Setting brightness={brightness}, temperature={temperature_kelvin}K")

        generate_lut1d(lut1d_path, brightness, temperature_kelvin)
        
        for display in self.displays:
            set_xprop(display, "GAMESCOPE_COMPOSITE_FORCE", "8c", 1)
            set_xprop(display, "GAMESCOPE_COLOR_3DLUT_OVERRIDE", "8u", lut3d_path)
            set_xprop(display, "GAMESCOPE_COLOR_SHAPERLUT_OVERRIDE", "8u", lut1d_path)

    async def set_vibrancy(self, vibrancy: float):
        decky_plugin.logger.info(f"Set raw vibrancy to: {vibrancy}")

        vibrancy = float_to_long(vibrancy)

        decky_plugin.logger.info(f"Set vibrancy to: {vibrancy}")

        target_displays = set(self.displays)
        target_displays.add(":1")
        display_list = list(target_displays)

        for display in display_list:
            set_xprop(display, "GAMESCOPE_COMPOSITE_FORCE", "8c", 1)
            set_xprop(display, "GAMESCOPE_COLOR_SDR_GAMUT_WIDENESS", "32c", str(vibrancy))

    async def get_hdr_status(self) -> str:
        def return_result(result):
            return result

        if not self.displays:
            return return_result(0)
        
        display = self.displays[0]
        cmd = [
            "xprop",
            "-root",
            "-d", display,
            "GAMESCOPE_COLOR_APP_WANTS_HDR_FEEDBACK"
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True)

            # Проверяй наличие свойства И его значение
            if "not found" in result.stdout:
                return return_result(0)
            
            # Если свойство есть и равно 1 - HDR включена
            is_hdr = "= 1" in result.stdout

            if is_hdr:
                return return_result(1)
            else:
                return return_result(0)
        except Exception as e:
            return return_result(0)
        
    async def reset(self):
        decky_plugin.logger.info("Resetting")
        self.first_run = True
        for display in self.displays:
            remove_xprop(display, "GAMESCOPE_COMPOSITE_FORCE")
            remove_xprop(display, "GAMESCOPE_COLOR_3DLUT_OVERRIDE")
            remove_xprop(display, "GAMESCOPE_COLOR_SHAPERLUT_OVERRIDE")
            remove_xprop(display, "GAMESCOPE_COLOR_SDR_GAMUT_WIDENESS")

    async def _unload(self):
        decky_plugin.logger.info("Overlay plugin stopped")
        if not self.first_run:
            await self.reset()
    