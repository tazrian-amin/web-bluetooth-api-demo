const HM10_SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
const HM10_CHARACTERISTIC_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";

let bleDevice = null;
let rxCharacteristic = null;
let byteBuffer = [];
let myChart = null; // Global Chart Instance

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const valueDisplay = document.getElementById("valueDisplay");
const statusText = document.getElementById("status");
const controlPanel = document.getElementById("controlPanel");

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
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: false },
      },
    },
  });
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
      }
    }
  }
}

// Push data and manage rolling array size bounds
function updateChartData(newValue) {
  if (!myChart) return;

  const currentTimeString = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  myChart.data.labels.push(currentTimeString);
  myChart.data.datasets[0].data.push(newValue);

  // Maintain max bounds of 15 trace points to preserve memory integrity
  if (myChart.data.labels.length > 15) {
    myChart.data.labels.shift();
    myChart.data.datasets[0].data.shift();
  }

  myChart.update(); // Trigger visualization rerender execution
}

async function sendHardwareCommand(commandValue) {
  if (!rxCharacteristic) return;
  try {
    const dataBuffer = Uint8Array.of(commandValue);
    await rxCharacteristic.writeValue(dataBuffer);
    console.log(`Command Out -> 0x0${commandValue}`);
  } catch (error) {
    console.error("Transmission failed:", error);
    statusText.innerText = `Write Error: ${error.message}`;
  }
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
