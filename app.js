const HM10_SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
const HM10_CHARACTERISTIC_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";

let bleDevice = null;
let rxCharacteristic = null;
let byteBuffer = [];
let myChart = null; // Global Chart Instance

const PIXELS_PER_POINT = 50; // Horizontal spacing per point so the trace never looks congested
const MAX_POINTS = 1000; // Safety cap on retained history to bound memory over long sessions

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const valueDisplay = document.getElementById("valueDisplay");
const statusText = document.getElementById("status");
const chartScroll = document.getElementById("chartScroll");
const chartInner = document.getElementById("chartInner");
const controlPanel = document.getElementById("controlPanel");
const periodInput = document.getElementById("periodInput");
const periodStatus = document.getElementById("periodStatus");

// Classic BLE 4.0 ATT MTU (23 bytes) minus the 3-byte header, matching the HM-10's default link budget
const MAX_BLE_WRITE_CHUNK_BYTES = 20;

// Initialize the Chart.js Instance on Document Load
window.addEventListener("DOMContentLoaded", () => {
  if (typeof Chart === "undefined") {
    console.warn("Chart.js not loaded yet");
    statusText.innerText = "Waiting for Chart.js to load...";
    return;
  }

  const ctx = document.getElementById("telemetryChart").getContext("2d");
  myChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [], // Stores matching localized timestamp strings
      datasets: [
        {
          label: "Raw ADC Value",
          data: [], // Appended live values
          borderColor: "#28a745",
          backgroundColor: "rgba(40, 167, 69, 0.1)",
          borderWidth: 2,
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: false },
      },
    },
  });

  chartInner.style.width = `${chartScroll.clientWidth}px`;
  window.addEventListener("resize", resizeChartWidth);

  console.log("Chart.js initialized");
});

async function connectBLE() {
  try {
    // Check if Web Bluetooth API is available
    if (!navigator.bluetooth) {
      statusText.innerText =
        "Error: Web Bluetooth API not supported in this browser";
      console.error("Web Bluetooth API is not available");
      return;
    }

    statusText.innerText = "Status: Searching for HM-10...";
    bleDevice = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HM10_SERVICE_UUID] }],
    });

    statusText.innerText = "Status: Connecting to GATT Server...";
    bleDevice.addEventListener("gattserverdisconnected", onDisconnected);
    const server = await bleDevice.gatt.connect();

    statusText.innerText = "Status: Discovering Services...";
    const service = await server.getPrimaryService(HM10_SERVICE_UUID);
    rxCharacteristic = await service.getCharacteristic(
      HM10_CHARACTERISTIC_UUID,
    );

    statusText.innerText = "Status: Subscribing to stream...";
    await rxCharacteristic.startNotifications();
    rxCharacteristic.addEventListener(
      "characteristicvaluechanged",
      handleIncomingBytes,
    );

    statusText.innerText = "Status: Connected!";
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "block";
    controlPanel.style.display = "block";

    // Ask the firmware for its current config, including the live sample period,
    // so the input reflects reality rather than a guessed default.
    sendBleCommand({ cmd: "get_config" });
  } catch (error) {
    console.error("BLE Error: ", error);
    statusText.innerText = `Error: ${error.message}`;
  }
}

function handleIncomingBytes(event) {
  const dataView = event.target.value;

  // Convert incoming bytes to ASCII string
  let incomingStr = "";
  for (let i = 0; i < dataView.byteLength; i++) {
    incomingStr += String.fromCharCode(dataView.getUint8(i));
  }

  // Append to buffer
  byteBuffer.push(...incomingStr);
  let bufferStr = byteBuffer.join("");

  // Look for complete lines (ending with \r\n or \n)
  const lines = bufferStr.split(/\r?\n/);

  // Keep the last incomplete line in buffer (if any)
  byteBuffer = lines[lines.length - 1].split("");

  // Process all complete lines
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    if (line.length > 0) {
      console.log("Received:", line);

      // Parse "ADC value:<number>" format
      const match = line.match(/ADC value:(\d+)/i);
      if (match) {
        const adcValue = parseInt(match[1], 10);
        console.log("ADC Value:", adcValue);

        valueDisplay.innerText = adcValue;
        updateChartData(adcValue);
      } else if (line.startsWith("{")) {
        // Firmware command replies (e.g. set_sample_period, get_config) are single-line JSON.
        handleDeviceResponse(line);
      }
    }
  }
}

// Surface firmware command replies (status/msg/period_ms) in the period control's status line
function handleDeviceResponse(line) {
  let response;
  try {
    response = JSON.parse(line);
  } catch (error) {
    console.warn("Could not parse device response:", line);
    return;
  }

  if (typeof response.period_ms === "number") {
    periodInput.value = Math.round(response.period_ms / 1000);
  }
  if (response.msg) {
    periodStatus.innerText = response.msg;
  } else if (response.status === "ok" && typeof response.period_ms === "number") {
    periodStatus.innerText = `Current period: ${response.period_ms / 1000}s`;
  }
}

// Write a JSON command to the HM-10's transparent UART characteristic, chunked to the BLE write limit.
async function sendBleCommand(commandObj) {
  if (!rxCharacteristic) {
    periodStatus.innerText = "Not connected";
    return;
  }

  const payload = JSON.stringify(commandObj) + "\n";
  const bytes = new TextEncoder().encode(payload);

  try {
    for (let offset = 0; offset < bytes.length; offset += MAX_BLE_WRITE_CHUNK_BYTES) {
      const chunk = bytes.slice(offset, offset + MAX_BLE_WRITE_CHUNK_BYTES);
      if (rxCharacteristic.properties.writeWithoutResponse) {
        await rxCharacteristic.writeValueWithoutResponse(chunk);
      } else {
        await rxCharacteristic.writeValue(chunk);
      }
    }
    console.log("Command Out ->", payload.trim());
  } catch (error) {
    console.error("BLE write failed:", error);
    periodStatus.innerText = `Write Error: ${error.message}`;
  }
}

// Triggered by the "Set Period" button: validates the input and sends set_sample_period.
async function setSamplePeriod() {
  const seconds = parseInt(periodInput.value, 10);
  if (isNaN(seconds) || seconds <= 0) {
    periodStatus.innerText = "Enter a valid number of seconds";
    return;
  }

  periodStatus.innerText = "Sending...";
  await sendBleCommand({ cmd: "set_sample_period", period_ms: seconds * 1000 });
}

// Push data, grow the chart horizontally, and keep the latest point in view
function updateChartData(newValue) {
  if (!myChart) return;

  const currentTimeString = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const wasNearEnd = isScrolledNearEnd();

  myChart.data.labels.push(currentTimeString);
  myChart.data.datasets[0].data.push(newValue);

  // Maintain max bounds to preserve memory integrity over long sessions
  if (myChart.data.labels.length > MAX_POINTS) {
    myChart.data.labels.shift();
    myChart.data.datasets[0].data.shift();
  }

  resizeChartWidth();
  myChart.update(); // Trigger visualization rerender execution

  if (wasNearEnd) {
    chartScroll.scrollLeft = chartScroll.scrollWidth;
  }
}

// Grow the chart's inner width with the point count so spacing stays constant
function resizeChartWidth() {
  const pointCount = myChart.data.labels.length;
  const neededWidth = pointCount * PIXELS_PER_POINT;
  chartInner.style.width = `${Math.max(chartScroll.clientWidth, neededWidth)}px`;
}

// True if the user is viewing (or near) the latest data, so it's safe to auto-scroll
function isScrolledNearEnd() {
  const distanceFromEnd =
    chartScroll.scrollWidth - chartScroll.scrollLeft - chartScroll.clientWidth;
  return distanceFromEnd < PIXELS_PER_POINT * 2;
}

function disconnectBLE() {
  if (bleDevice && bleDevice.gatt.connected) {
    bleDevice.gatt.disconnect();
  }
}

function onDisconnected() {
  statusText.innerText = "Status: Disconnected";
  valueDisplay.innerText = "--.--";
  connectBtn.style.display = "block";
  disconnectBtn.style.display = "none";
  controlPanel.style.display = "none";
  periodStatus.innerText = "";
  byteBuffer = [];
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => console.log("PWA Service Worker Active:", reg.scope))
      .catch((err) => console.error("PWA Service Worker failed:", err));
  });
}
