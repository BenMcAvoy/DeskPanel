import asyncio
import contextlib
import importlib
import json
import logging
import os
import threading
import time
from typing import Any

import websockets

try:
	GPIO: Any | None = importlib.import_module("RPi.GPIO")
except ModuleNotFoundError:
	GPIO = None


logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s")
LOGGER = logging.getLogger("control_agent")

HOST = os.environ.get("CONTROL_AGENT_HOST", "0.0.0.0")
PORT = int(os.environ.get("CONTROL_AGENT_PORT", "6789"))

CLK_PIN = int(os.environ.get("CONTROL_AGENT_CLK_PIN", "17"))
DT_PIN = int(os.environ.get("CONTROL_AGENT_DT_PIN", "27"))
SW_PIN = int(os.environ.get("CONTROL_AGENT_SW_PIN", "22"))
POLL_INTERVAL_S = float(os.environ.get("CONTROL_AGENT_POLL_INTERVAL_S", "0.0005"))
BUTTON_DEBOUNCE_S = float(os.environ.get("CONTROL_AGENT_BUTTON_DEBOUNCE_S", "0.2"))

TRANSITION_TABLE = {
	0b0001: -1,
	0b0111: -1,
	0b1110: -1,
	0b1000: -1,
	0b0010: 1,
	0b0100: 1,
	0b1101: 1,
	0b1011: 1,
}


def require_gpio() -> Any:
	if GPIO is None:
		raise RuntimeError("RPi.GPIO is not installed in this environment")

	return GPIO


class EncoderHub:
	def __init__(self) -> None:
		self.clients: set[Any] = set()

	async def handler(self, websocket: Any) -> None:
		self.clients.add(websocket)
		LOGGER.info("Frontend connected: %s", websocket.remote_address)

		try:
			async for _message in websocket:
				LOGGER.debug("Ignoring inbound websocket message")
		finally:
			self.clients.discard(websocket)
			LOGGER.info("Frontend disconnected: %s", websocket.remote_address)

	async def broadcast(self, event: dict[str, Any]) -> None:
		if not self.clients:
			return

		payload = json.dumps(event)
		results = await asyncio.gather(
			*(client.send(payload) for client in tuple(self.clients)),
			return_exceptions=True,
		)

		for result in results:
			if isinstance(result, Exception):
				LOGGER.warning("Broadcast failed: %s", result)


class GpioEncoder:
	def __init__(self, hub: EncoderHub, loop: asyncio.AbstractEventLoop) -> None:
		self.hub = hub
		self.loop = loop
		self.stop_event = threading.Event()
		self.thread: threading.Thread | None = None
		self.last_state = 0
		self.counter = 0
		self.last_button_time = 0.0
		self.started = False

	def start(self) -> None:
		gpio = require_gpio()

		gpio.setmode(gpio.BCM)
		gpio.setup(CLK_PIN, gpio.IN, pull_up_down=gpio.PUD_UP)
		gpio.setup(DT_PIN, gpio.IN, pull_up_down=gpio.PUD_UP)
		gpio.setup(SW_PIN, gpio.IN, pull_up_down=gpio.PUD_UP)

		self.last_state = (gpio.input(CLK_PIN) << 1) | gpio.input(DT_PIN)
		gpio.add_event_detect(
			SW_PIN,
			gpio.BOTH,
			callback=self._button_callback,
			bouncetime=max(1, int(BUTTON_DEBOUNCE_S * 1000)),
		)

		self.thread = threading.Thread(target=self._poll_rotation, name="gpio-encoder", daemon=True)
		self.thread.start()
		self.started = True
		LOGGER.info("GPIO encoder ready on BCM pins clk=%s dt=%s sw=%s", CLK_PIN, DT_PIN, SW_PIN)

	def close(self) -> None:
		if not self.started:
			return

		self.stop_event.set()
		if self.thread is not None:
			self.thread.join(timeout=1)

		gpio = require_gpio()
		with contextlib.suppress(RuntimeError):
			gpio.remove_event_detect(SW_PIN)
		with contextlib.suppress(RuntimeError):
			gpio.cleanup((CLK_PIN, DT_PIN, SW_PIN))

		self.started = False

	def _broadcast_from_thread(self, event: dict[str, Any]) -> None:
		future = asyncio.run_coroutine_threadsafe(self.hub.broadcast(event), self.loop)
		try:
			future.result(timeout=1)
		except TimeoutError:
			LOGGER.warning("Timed out broadcasting encoder event: %s", event)
		except Exception as exc:
			LOGGER.warning("Failed to broadcast encoder event %s: %s", event, exc)

	def _button_callback(self, _channel: int) -> None:
		now = time.monotonic()
		if now - self.last_button_time <= BUTTON_DEBOUNCE_S:
			return

		self.last_button_time = now
		gpio = require_gpio()
		pressed = gpio.input(SW_PIN) == gpio.LOW
		LOGGER.info("Button %s", "pressed" if pressed else "released")
		self._broadcast_from_thread({"type": "button", "pressed": pressed})

	def _poll_rotation(self) -> None:
		gpio = require_gpio()
		while not self.stop_event.is_set():
			state = (gpio.input(CLK_PIN) << 1) | gpio.input(DT_PIN)
			transition = (self.last_state << 2) | state

			direction = TRANSITION_TABLE.get(transition)
			if direction is not None:
				self.counter += direction
				LOGGER.info(
					"Rotated %s (%s)",
					"clockwise" if direction == 1 else "counterclockwise",
					self.counter,
				)
				self._broadcast_from_thread({"type": "rotate", "delta": direction})

			self.last_state = state
			self.stop_event.wait(POLL_INTERVAL_S)


async def main() -> None:
	hub = EncoderHub()
	loop = asyncio.get_running_loop()
	encoder: GpioEncoder | None = None

	LOGGER.info("Starting control agent on ws://%s:%s", HOST, PORT)

	if GPIO is None:
		LOGGER.warning("RPi.GPIO is unavailable. The websocket server will run, but no GPIO events will be emitted.")
	else:
		try:
			encoder = GpioEncoder(hub, loop)
			encoder.start()
		except Exception:
			LOGGER.exception("Failed to initialize GPIO encoder")

	try:
		async with websockets.serve(hub.handler, HOST, PORT):
			await asyncio.Future()
	finally:
		if encoder is not None:
			encoder.close()


if __name__ == "__main__":
	try:
		asyncio.run(main())
	except KeyboardInterrupt:
		LOGGER.info("Control agent stopped")
