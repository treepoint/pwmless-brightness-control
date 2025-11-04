import os
import struct
import subprocess
from typing import Any, List

import decky
import decky_plugin

LUT1D_SIZE = 4096
LUT3D_SIZE = 17

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

def generate_lut1d(output: str, brightness: float):
    decky_plugin.logger.info(f"Generating LUT1D: output={output}, brightness={brightness}")

    if brightness < 0 or brightness > 1:
        decky_plugin.logger.error("Invalid brightness")
        raise ValueError("Brightness must be between 0 and 1")
    to_unit = lambda i: i / (LUT1D_SIZE - 1) * brightness
    try:
        with open(output, "wb") as f:
            for x in range(LUT1D_SIZE):
                bs = struct.pack(
                    "<HHHH",
                    quantize(to_unit(x)),
                    quantize(to_unit(x)),
                    quantize(to_unit(x)),
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

class Plugin:
    async def activate(self):
        decky_plugin.logger.info("Activating")
        self.displays = get_steam_displays()
        self.first_run = True
        generate_lut3d(lut3d_path, 1.0)
        decky_plugin.logger.info(f"Found steam displays: {self.displays}")

    async def set_brightness(self, brightness: float):
        decky_plugin.logger.info(f"Change brightness to {brightness}")

        generate_lut1d(lut1d_path, brightness)
        for display in self.displays:
            set_xprop(display, "GAMESCOPE_COMPOSITE_FORCE", "8c", 1)
            set_xprop(display, "GAMESCOPE_COLOR_3DLUT_OVERRIDE", "8u", lut3d_path)
            set_xprop(display, "GAMESCOPE_COLOR_SHAPERLUT_OVERRIDE", "8u", lut1d_path)

    async def reset(self):
        decky_plugin.logger.info("Resetting")
        self.first_run = True
        for display in self.displays:
            remove_xprop(display, "GAMESCOPE_COMPOSITE_FORCE")
            remove_xprop(display, "GAMESCOPE_COLOR_SHAPERLUT_OVERRIDE")
            remove_xprop(display, "GAMESCOPE_COLOR_3DLUT_OVERRIDE")

    async def _unload(self):
        decky_plugin.logger.info("Overlay plugin stopped")
        if not self.first_run:
            await self.reset()
