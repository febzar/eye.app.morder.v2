/**
 * Input Execution Module
 * Uses robotjs to execute mouse and keyboard events received from the client.
 * 
 * On Windows, robotjs handles Win32 input simulation natively.
 * Requires: npm install robotjs (needs node-gyp and build tools on Windows)
 */

let robot = null;
let robotAvailable = false;

// Try to load robotjs
try {
  robot = require('robotjs');
  robot.setMouseDelay(0);
  robot.setKeyboardDelay(0);
  robotAvailable = true;
  console.log('[INPUT] robotjs loaded successfully');
} catch (err) {
  console.warn('[INPUT] robotjs not available:', err.message);
  console.warn('[INPUT] Mouse/keyboard control disabled. Run: npm install robotjs');
}

/**
 * Execute an input event from the client
 * @param {Object} data - Input event data
 */
function executeInput(data) {
  if (!robotAvailable || !robot) {
    console.warn('[INPUT] robotjs unavailable, ignoring input:', data.type);
    return;
  }

  try {
    switch (data.type) {
      // ── Mouse Events ────────────────────────────────────────────────────────
      case 'mousemove': {
        const { x, y } = screenCoords(data.x, data.y, data.screenW, data.screenH);
        robot.moveMouse(x, y);
        break;
      }

      case 'mousedown': {
        const { x, y } = screenCoords(data.x, data.y, data.screenW, data.screenH);
        robot.moveMouse(x, y);
        robot.mouseToggle('down', mapButton(data.button));
        break;
      }

      case 'mouseup': {
        const { x, y } = screenCoords(data.x, data.y, data.screenW, data.screenH);
        robot.moveMouse(x, y);
        robot.mouseToggle('up', mapButton(data.button));
        break;
      }

      case 'click': {
        const { x, y } = screenCoords(data.x, data.y, data.screenW, data.screenH);
        robot.moveMouse(x, y);
        robot.mouseClick(mapButton(data.button), data.double || false);
        break;
      }

      case 'scroll': {
        const { x, y } = screenCoords(data.x, data.y, data.screenW, data.screenH);
        robot.moveMouse(x, y);
        robot.scrollMouse(data.deltaX || 0, data.deltaY || 0);
        break;
      }

      // ── Keyboard Events ──────────────────────────────────────────────────────
      case 'keydown': {
        const key = mapKey(data.key);
        if (key) {
          const modifiers = buildModifiers(data.modifiers);
          robot.keyToggle(key, 'down', modifiers);
        }
        break;
      }

      case 'keyup': {
        const key = mapKey(data.key);
        if (key) {
          const modifiers = buildModifiers(data.modifiers);
          robot.keyToggle(key, 'up', modifiers);
        }
        break;
      }

      case 'keypress': {
        const key = mapKey(data.key);
        if (key) {
          const modifiers = buildModifiers(data.modifiers);
          robot.keyTap(key, modifiers);
        }
        break;
      }

      case 'type': {
        // Type a string of text
        if (data.text) robot.typeString(data.text);
        break;
      }

      default:
        console.warn('[INPUT] Unknown input type:', data.type);
    }
  } catch (err) {
    console.error('[INPUT] Error executing input:', err.message, data);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Coordinate Mapping
// ────────────────────────────────────────────────────────────────────────────
function screenCoords(normX, normY, srcW, srcH) {
  const screenSize = robot.getScreenSize();
  return {
    x: Math.round((normX / srcW) * screenSize.width),
    y: Math.round((normY / srcH) * screenSize.height),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Mouse Button Mapping
// ────────────────────────────────────────────────────────────────────────────
function mapButton(btn) {
  switch (btn) {
    case 2: return 'right';
    case 1: return 'middle';
    default: return 'left';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Modifier Keys
// ────────────────────────────────────────────────────────────────────────────
function buildModifiers(mods) {
  if (!mods) return [];
  const result = [];
  if (mods.ctrl) result.push('control');
  if (mods.shift) result.push('shift');
  if (mods.alt) result.push('alt');
  if (mods.meta) result.push('command');
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Key Mapping (Browser KeyboardEvent.key → robotjs key names)
// ────────────────────────────────────────────────────────────────────────────
const KEY_MAP = {
  'Enter': 'enter', 'Tab': 'tab', 'Escape': 'escape', 'Backspace': 'backspace',
  'Delete': 'delete', 'Insert': 'insert', 'Home': 'home', 'End': 'end',
  'PageUp': 'pageup', 'PageDown': 'pagedown',
  'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
  'F1': 'f1', 'F2': 'f2', 'F3': 'f3', 'F4': 'f4', 'F5': 'f5',
  'F6': 'f6', 'F7': 'f7', 'F8': 'f8', 'F9': 'f9', 'F10': 'f10',
  'F11': 'f11', 'F12': 'f12',
  'Control': 'control', 'Shift': 'shift', 'Alt': 'alt', 'Meta': 'command',
  ' ': 'space', 'CapsLock': 'caps_lock', 'PrintScreen': 'printscreen',
};

function mapKey(browserKey) {
  if (!browserKey) return null;
  if (KEY_MAP[browserKey]) return KEY_MAP[browserKey];
  // Single character keys
  if (browserKey.length === 1) return browserKey.toLowerCase();
  return null;
}

module.exports = { executeInput, robotAvailable };
