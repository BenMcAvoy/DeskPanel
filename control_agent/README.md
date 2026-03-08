# Control Agent

The control agent runs inside the DeskPanel container and reads the rotary encoder over GPIO.

## Docker Compose

From the repository root on the Raspberry Pi:

```sh
docker compose up --build -d
```

The included [docker-compose.yml](../docker-compose.yml) maps these GPIO devices into the container:

- `/dev/gpiomem`
- `/dev/gpiochip0`

If your Pi exposes a different gpiochip number, update the compose file to match `ls /dev/gpiochip*`.

## Docker CLI

Build the image:

```sh
docker build -t deskpanel .
```

Run it with GPIO access:

```sh
docker run -d \
	--name deskpanel \
	--restart unless-stopped \
	-p 4173:4173 \
	-p 6789:6789 \
	--device /dev/gpiomem:/dev/gpiomem \
	--device /dev/gpiochip0:/dev/gpiochip0 \
	-e CONTROL_AGENT_CLK_PIN=17 \
	-e CONTROL_AGENT_DT_PIN=27 \
	-e CONTROL_AGENT_SW_PIN=22 \
	deskpanel
```

If `RPi.GPIO` still cannot access the hardware, confirm the container can see the devices and that the host kernel exposes the expected GPIO interfaces.
