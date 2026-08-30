/*
 * EQOband Firmware - Seeed Studio XIAO ESP32-C3 + MAX30102 heart rate sensor
 * ---------------------------------------------------------------------------
 * BLE service the EQOband mobile app expects. Flash this to your ESP32-C3 and
 * open the app > Device > REAL BLE (BETA) > Scan devices. Tap "EQOband-C3" to
 * connect - the app will then auto-subscribe to the HR characteristic and
 * stream live BPM into the Live Heart Rate card on the Health tab.
 *
 * Board:    Seeed Studio XIAO ESP32-C3 (Arduino core: esp32 >= 2.0.14)
 * Libs:     NimBLE-Arduino (h2zero) OR the built-in BLE lib shown here
 *           SparkFun MAX3010x Pulse and Proximity Sensor Library
 *
 * UUIDs (must match /app/frontend/src/utils/ble.ts):
 *   Service:            6e400001-b5a3-f393-e0a9-e50e24dcca9e
 *   HR notify char:     6e400002-b5a3-f393-e0a9-e50e24dcca9e   uint8 BPM
 *   Battery read char:  6e400003-b5a3-f393-e0a9-e50e24dcca9e   uint8 percent
 *
 * Wiring:  MAX30102 SDA -> GPIO 6, SCL -> GPIO 7, VIN -> 3V3, GND -> GND
 */

#include <Arduino.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include "MAX30105.h"
#include "heartRate.h"

#define SERVICE_UUID  "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define HR_CHAR_UUID  "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define BAT_CHAR_UUID "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

MAX30105 sensor;

const byte RATE_SIZE = 4;
byte rates[RATE_SIZE] = {0};
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute = 0;
int beatAvg = 0;

BLECharacteristic *hrChar;
BLECharacteristic *batChar;
bool bleConnected = false;

class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { bleConnected = true; }
  void onDisconnect(BLEServer *s) override {
    bleConnected = false;
    s->getAdvertising()->start();
  }
};

void setup() {
  Serial.begin(115200);
  Wire.begin(6, 7); // SDA, SCL

  if (!sensor.begin(Wire, I2C_SPEED_FAST)) {
    Serial.println("MAX30102 not found - check wiring");
  } else {
    sensor.setup();
    sensor.setPulseAmplitudeRed(0x0A);
    sensor.setPulseAmplitudeGreen(0);
  }

  BLEDevice::init("EQOband-C3");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCB());
  BLEService *service = server->createService(SERVICE_UUID);

  hrChar = service->createCharacteristic(HR_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  hrChar->addDescriptor(new BLE2902());

  batChar = service->createCharacteristic(BAT_CHAR_UUID, BLECharacteristic::PROPERTY_READ);
  uint8_t bat = 86; // TODO: measure real battery via ADC pin
  batChar->setValue(&bat, 1);

  service->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("EQOband-C3 advertising over BLE");
}

void loop() {
  long ir = sensor.getIR();
  if (checkForBeat(ir)) {
    long delta = millis() - lastBeat;
    lastBeat = millis();
    beatsPerMinute = 60.0 / (delta / 1000.0);
    if (beatsPerMinute > 20 && beatsPerMinute < 220) {
      rates[rateSpot++] = (byte)beatsPerMinute;
      rateSpot %= RATE_SIZE;
      int sum = 0;
      for (byte i = 0; i < RATE_SIZE; i++) sum += rates[i];
      beatAvg = sum / RATE_SIZE;
    }
  }

  if (bleConnected && beatAvg > 0) {
    uint8_t payload = (uint8_t)beatAvg;
    hrChar->setValue(&payload, 1);
    hrChar->notify();
    delay(200); // ~5 Hz notification cadence
  } else {
    delay(50);
  }
}
