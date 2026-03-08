import asyncio
import json
import logging
import os
from typing import Any

import websockets


logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s")
LOGGER = logging.getLogger("control_agent")

HOST = os.environ.get("CONTROL_AGENT_HOST", "0.0.0.0")
PORT = int(os.environ.get("CONTROL_AGENT_PORT", "6789"))


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


async def main() -> None:
	hub = EncoderHub()

	LOGGER.info("Starting control agent on ws://%s:%s", HOST, PORT)
	LOGGER.info("GPIO integration is not enabled in this build.")

	async with websockets.serve(hub.handler, HOST, PORT):
		await asyncio.Future()


if __name__ == "__main__":
	try:
		asyncio.run(main())
	except KeyboardInterrupt:
		LOGGER.info("Control agent stopped")
