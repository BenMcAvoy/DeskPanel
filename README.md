# DeskPanel

DeskPanel is a self-hosted control panel for a desk display. Its React interface brings together Spotify playback and Home Assistant controls, while a small Python service reads a Raspberry Pi rotary encoder and sends input events to the browser over a WebSocket.

## Run with Docker

The included Compose setup is intended for a Raspberry Pi with a rotary encoder wired to the configured GPIO pins. The container currently runs with privileged access so the control agent can read GPIO.

```sh
docker compose up --build -d
```

Frontend integration settings are listed in [`control_frontend/.env.example`](control_frontend/.env.example). The Dockerfile accepts them as the optional BuildKit secret `control_frontend_env`; set that during the frontend build when enabling Home Assistant or Spotify.

## Project layout

- `control_frontend/` - React and TypeScript interface.
- `control_agent/` - Python rotary encoder service.
- `docker-compose.yml` and `Dockerfile` - container setup.

This is a hardware-focused personal project and the GPIO defaults may need adjusting for your wiring.
