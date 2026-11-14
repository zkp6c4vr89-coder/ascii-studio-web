# ASCII Studio: Web

Turn photos, videos and your webcam into colourful ASCII art, right in the browser.
Nothing is uploaded: everything runs on your device's graphics card (WebGL2).

- Drop in a photo or video, use the webcam, or watch the character rain
- Colour, Matrix and mono looks; tune character size, contrast, edge strokes, glow, shimmer and character speed
- Save PNG (up to 4K or your exact screen size), record seamless 5 / 10 / 15 s or custom loops, copy as text
- Works on desktop and mobile browsers (Chrome, Safari, Firefox, Edge). On phones it saves
  through the share sheet (Save to Photos), switches front/back camera, and can be added to the
  home screen as an app
- Light and dark mode; respects Reduce Motion, Reduce Transparency and Increase Contrast

## Run it
No build step. Serve the folder with any static server:
```
python3 -m http.server 8000
```
Then open http://localhost:8000. (Webcam access needs `localhost` or HTTPS.)

## Files
| File | What it is |
|---|---|
| `index.html`, `style.css`, `app.js` | The studio page |
| `renderer.js` | The ASCII engine: WebGL2 shaders (grid → glyphs → glow) |
| `wallpaper.html` | Fullscreen, UI-less version used for animated wallpapers |
| `wallpaper-store.js` | Saves the browser-extension wallpaper on the device (IndexedDB) |
| `manifest.webmanifest` | Lets phones install it to the home screen |
| `brand/` | The logo (an orb drawn in characters) and every icon size; `make_logo.py` redraws them |

## How it works
1. Average the picture inside every character cell.
2. Brightness picks a character with matching "ink" (`.` dark → `@` bright); the ramp is sorted
   by measuring each character in the actual font.
3. Strong edges become strokes that follow them: `| / - \ _`.
4. Colour each character, stamp it from a pre-drawn glyph sheet, add glow.

Sister projects: **ascii-studio-extension** (Chrome / Firefox / Edge extension with right-click
"Turn into ASCII art" and an animated new-tab wallpaper) and **ascii-studio-desktop**
(macOS: live ASCII webcam for Zoom, file converter, animated desktop wallpaper).
