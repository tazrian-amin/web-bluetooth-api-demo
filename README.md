# PWA Prototype

A small Progressive Web App that connects to an HM-10 BLE module over the
[Web Bluetooth API](https://developer.chrome.com/docs/capabilities/bluetooth)
and plots live ADC readings from the hardware in real time.

Live demo: https://tazrian-amin.github.io/web-bluetooth-api-demo/

## How it works

A Blues Swan R5 (with Notecarrier-F + Notecard) samples a sensor on its ADC
pin and streams each reading as plain text over a UART-bridged HM-10 BLE 4.0
module:

```
ADC value:<number>\r\n
```

This page uses `navigator.bluetooth.requestDevice()` to connect directly to
the HM-10's GATT service (`0xFFE0`) and characteristic (`0xFFE1`), subscribes
to notifications, parses the `ADC value:` lines, and renders them as:

- a live numeric readout
- a rolling Chart.js line chart (last 15 points)

## Running it

Web Bluetooth only works in Chromium-based browsers (Chrome, Edge, Opera —
not Safari or Firefox) and only on a secure origin (`https://`, or
`http://localhost` on the same machine as the browser). Open the page, click
**Connect to Device**, and pick the HM-10 from the browser's device picker.

## Files

| File            | Purpose                                              |
| --------------- | ----------------------------------------------------- |
| `index.html`    | Page markup                                          |
| `style.css`     | Styling                                              |
| `app.js`        | Web Bluetooth connection logic, parsing, charting     |
| `manifest.json` | PWA manifest (installable app, icons)                |
| `sw.js`         | Service worker (cache-first asset caching for PWA)    |

## Notes

- The HM-10's advertised UUIDs and default baud rate (9600) are assumed to
  match factory defaults.
- Bump `CACHE_NAME` in `sw.js` whenever you change a cached asset, otherwise
  browsers that already installed the service worker will keep serving the
  old cached files.
