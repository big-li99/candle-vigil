// Keyboard + pointer intent. `down` is held state; `pressed` is a one-step edge set cleared after every
// fixed step. The bind map is the single place a physical key becomes a game action.

export const bind = {
  Digit1: "slot1",
  Numpad1: "slot1",
  Digit2: "slot2",
  Numpad2: "slot2",
  Digit3: "slot3",
  Numpad3: "slot3",
  Digit4: "slot4",
  Numpad4: "slot4",
  Space: "block",
  Escape: "cancel",
  KeyP: "pause",
};

export function createInput(canvas) {
  const down = new Set();
  const pressedCodes = new Set();
  const pressedActions = new Set();
  let anyPressed = false;

  function press(code, action) {
    pressedCodes.add(code);
    if (action) pressedActions.add(action);
    anyPressed = true;
  }

  function onKeyDown(e) {
    down.add(e.code);
    if (e.repeat) return;
    if (e.code === "Space") e.preventDefault();
    press(e.code, bind[e.code]);
  }

  function onKeyUp(e) {
    down.delete(e.code);
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / Math.max(1, rect.width);
    // Placeholder touch mapping for M1: left third = 1, right third = 2. The middle only counts as "any key".
    if (x < 1 / 3) press("Pointer", "slot1");
    else if (x > 2 / 3) press("Pointer", "slot2");
    else anyPressed = true;
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => down.clear());
  canvas.addEventListener("pointerdown", onPointerDown);

  return {
    bind,
    isDown: (code) => down.has(code),
    pressed: (action) => pressedActions.has(action),
    pressedCode: (code) => pressedCodes.has(code),
    anyPressed: () => anyPressed,
    clearEdges() {
      pressedCodes.clear();
      pressedActions.clear();
      anyPressed = false;
    },
  };
}
