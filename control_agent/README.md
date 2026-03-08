# Control Agent

The control agent runs inside the DeskPanel container and reads the rotary encoder over GPIO.

For now the container is expected to run privileged.

## Docker Compose

From the repository root on the Raspberry Pi:

```sh
docker compose up --build -d
```

The included [docker-compose.yml](../docker-compose.yml) maps these GPIO devices into the container:

It uses `privileged: true` so GPIO access works without managing individual device mappings.

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
	--privileged \
	-p 4173:4173 \
	-p 6789:6789 \
	-e CONTROL_AGENT_CLK_PIN=17 \
	-e CONTROL_AGENT_DT_PIN=27 \
	-e CONTROL_AGENT_SW_PIN=22 \
	-e CONTROL_AGENT_ROTATION_STEPS_PER_NOTCH=4 \
	deskpanel
```

If the dial still feels too sensitive, increase `CONTROL_AGENT_ROTATION_STEPS_PER_NOTCH`. The current default is `4`, which emits one frontend step per full quadrature cycle instead of every edge.
