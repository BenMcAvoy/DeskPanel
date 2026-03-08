import tkinter as tk
import asyncio
import threading
import websockets
import json
import math
import logging

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s: %(message)s')

clients = set()
ws_loop = asyncio.new_event_loop()

async def handler(ws):
    clients.add(ws)
    logging.info(f"Client connected: {ws.remote_address}")
    try:
        await ws.wait_closed()
    finally:
        clients.remove(ws)
        logging.info(f"Client disconnected: {ws.remote_address}")

async def broadcast(event):
    if clients:
        msg = json.dumps(event)
        await asyncio.gather(*[c.send(msg) for c in clients])
        logging.info(f"Broadcasted event: {event}")

async def websocket_loop():
    async with websockets.serve(handler, "0.0.0.0", 6789):
        logging.info("WebSocket server started on port 6789")
        await asyncio.Future()  # run forever

def start_ws_loop():
    asyncio.set_event_loop(ws_loop)
    ws_loop.run_until_complete(websocket_loop())
    ws_loop.run_forever()

root = tk.Tk()
root.title("Fake Rotary Encoder (Scroll Wheel + Click)")

canvas_size = 200
canvas = tk.Canvas(root, width=canvas_size, height=canvas_size, bg="#f0f0f0")
canvas.pack(padx=20, pady=20)

# Center and radius
center = canvas_size // 2
radius = 80

# Positions: `target_position` is the logical encoder steps (integers),
# `display_position` is a float used for smooth animation on the canvas.
target_position = 0
display_position = 0.0

# Animation parameters
ANIMATION_EASING = 0.25  # interpolation factor per tick (0-1)
TICK_MS = 16  # approx 60 FPS

# Draw dial
dial = canvas.create_oval(center-radius, center-radius, center+radius, center+radius,
                          fill="#dddddd", outline="#888888", width=2)
pointer = canvas.create_line(center, center, center, center-radius,
                             width=6, fill="red", capstyle="round", smooth=True)

def update_pointer(pos):
    """Update pointer using the (possibly fractional) position value."""
    angle = math.radians((pos * 5) % 360)
    x = center + radius * math.sin(angle)
    y = center - radius * math.cos(angle)
    canvas.coords(pointer, center, center, x, y)
    canvas.update_idletasks()

def send_async(event_data):
    # Thread-safe coroutine submission
    asyncio.run_coroutine_threadsafe(broadcast(event_data), ws_loop)

def on_scroll(event):
    global target_position
    # event.delta >0 => wheel up; <0 => wheel down
    delta = 1 if event.delta > 0 else -1
    target_position += delta
    # Send relative delta to frontend instead of absolute position
    send_async({"type": "rotate", "delta": delta})
    logging.info(f"Rotated {'CW' if delta>0 else 'CCW'} delta={delta} target={target_position}")

# Track whether a press was sent so release always pairs with it
_button_pressed = False

def on_press(event):
    global _button_pressed
    dx = event.x - center
    dy = event.y - center
    if dx*dx + dy*dy <= radius*radius:
        _button_pressed = True
        send_async({"type": "button", "pressed": True})
        logging.info("Button pressed")

def on_release(event):
    global _button_pressed
    if _button_pressed:
        _button_pressed = False
        send_async({"type": "button", "pressed": False})
        logging.info("Button released")

# Bind mouse wheel and click
canvas.bind("<Button-1>", on_press)
canvas.bind("<ButtonRelease-1>", on_release)
canvas.bind("<MouseWheel>", on_scroll)  # Windows
canvas.bind("<Button-4>", lambda e: on_scroll(type('E', (), {'delta':1})))  # Linux scroll up
canvas.bind("<Button-5>", lambda e: on_scroll(type('E', (), {'delta':-1})))  # Linux scroll down

# Start WebSocket server in background
threading.Thread(target=start_ws_loop, daemon=True).start()


# Smooth GUI update using an interpolated display position
def tick():
    global display_position, target_position
    # interpolate display_position toward target_position
    diff = target_position - display_position
    if abs(diff) > 1e-4:
        display_position += diff * ANIMATION_EASING
    # If very close to integer, snap to exact value to avoid jitter
    if abs(display_position - round(display_position)) < 1e-3:
        display_position = round(display_position)
    update_pointer(display_position)
    root.after(TICK_MS, tick)

tick()
root.mainloop()