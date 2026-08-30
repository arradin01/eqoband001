/*
 * EQOband Firmware - Seeed Studio XIAO ESP32-C3 + MAX30102 + TTP223 Touch Sensor
 * ---------------------------------------------------------------------------
 * BLE service the EQOband mobile app expects. Flash this to your ESP32-C3 and
 * open the app > Device > REAL BLE (BETA) > Scan devices. Tap "EQOband-C3" to
 * connect - the app will auto-subscribe to HR & Gesture characteristics.
 *
 * Board:    Seeed Studio XIAO ESP32-C3 (Arduino core: esp32 >= 2.0.14)
 * Libs:     NimBLE-Arduino (h2zero) OR built-in BLE lib
 *           SparkFun MAX3010x Pulse and Proximity Sensor Library
 *
 * UUIDs (must match /app/frontend/src/utils/ble.ts):
 *   Service:            6e400001-b5a3-f393-e0a9-e50e24dcca9e
 *   HR notify char:     6e400002-b5a3-f393-e0a9-e50e24dcca9e   uint8 BPM
 *   Battery read char:  6e400003-b5a3-f393-e0a9-e50e24dcca9e   uint8 percent
 *   Gesture notify char:6e400004-b5a3-f393-e0a9-e50e24dcca9e   uint8 (1=SINGLE_TAP, 2=DOUBLE_TAP, 3=LONG_PRESS)
 *
 * Wiring:
 *   MAX30102:   SDA -> GPIO 6 (D4), SCL -> GPIO 7 (D5), VIN -> 3V3, GND -> GND
 *   TTP223:     SIG -> GPIO 3 (D1 / Touch Pin), VCC -> 3V3, GND -> GND
 */

#include <Arduino.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include "MAX30105.h"
#include "heartRate.h"

#define SERVICE_UUID      "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define HR_CHAR_UUID      "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define BAT_CHAR_UUID     "6e400003-b5a3-f393-e0a9-e50e24dcca9e"
#define GESTURE_CHAR_UUID "6e400004-b5a3-f393-e0a9-e50e24dcca9e"

#define TOUCH_PIN 3 // TTP223 digital output connected to GPIO 3

MAX30105 sensor;

const byte RATE_SIZE = 4;
byte rates[RATE_SIZE] = {0};
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute = 0;
int beatAvg = 0;

BLECharacteristic *hrChar;
BLECharacteristic *batChar;
BLECharacteristic *gestureChar;
bool bleConnected = false;

// TTP223 Gesture Classifier State
bool lastTouchState = LOW;
unsigned long touchStartTime = 0;
unsigned long lastReleaseTime = 0;
int tapCount = 0;
bool longPressTriggered = false;

const unsigned long DOUBLE_TAP_WINDOW = 350; // ms to wait for 2nd tap
const unsigned long LONG_PRESS_THRESHOLD = 1500; // ms held for long press
const unsigned long DEBOUNCE_DELAY = 30; // ms debounce

class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { bleConnected = true; }
  void onDisconnect(BLEServer *s) override {
    bleConnected = false;
    s->getAdvertising()->start();
  }
};

void sendGesture(uint8_t code) {
  if (bleConnected && gestureChar != nullptr) {
    gestureChar->setValue(&code, 1);
    gestureChar->notify();
    Serial.printf("BLE Gesture Sent: %d (%s)\n", code, 
      code == 1 ? "SINGLE_TAP" : code == 2 ? "DOUBLE_TAP" : "LONG_PRESS");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(TOUCH_PIN, INPUT);
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
  uint8_t bat = 86; // Can read via ADC on GPIO 0/1 with divider
  batChar->setValue(&bat, 1);

  gestureChar = service->createCharacteristic(GESTURE_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  gestureChar->addDescriptor(new BLE2902());

  service->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("EQOband-C3 advertising with Gesture (TTP223) + HR + Battery");
}

void handleTouchSensor() {
  bool currentTouchState = digitalRead(TOUCH_PIN);
  unsigned long now = millis();

  // Touch just pressed down
  if (currentTouchState == HIGH && lastTouchState == LOW) {
    touchStartTime = now;
    longPressTriggered = false;
  }
  // Currently holding touch down
  else if (currentTouchState == HIGH && lastTouchState == HIGH) {
    if (!longPressTriggered && (now - touchStartTime >= LONG_PRESS_THRESHOLD)) {
      longPressTriggered = true;
      tapCount = 0; // reset tap counter on long press
      sendGesture(3); // 3 = LONG_PRESS
    }
  }
  // Touch just released
  else if (currentTouchState == LOW && lastTouchState == HIGH) {
    unsigned long pressDuration = now - touchStartTime;
    if (!longPressTriggered && pressDuration >= DEBOUNCE_DELAY && pressDuration < LONG_PRESS_THRESHOLD) {
      tapCount++;
      lastReleaseTime = now;
      if (tapCount >= 2) {
        sendGesture(2); // 2 = DOUBLE_TAP
        tapCount = 0;
      }
    }
  }
  // Finger is up: check if single tap timed out without a 2nd tap
  else if (currentTouchState == LOW && lastTouchState == LOW) {
    if (tapCount == 1 && (now - lastReleaseTime > DOUBLE_TAP_WINDOW)) {
      sendGesture(1); // 1 = SINGLE_TAP
      tapCount = 0;
    }
  }

  lastTouchState = currentTouchState;
}

void loop() {
  // 1. Process TTP223 capacitive touch gestures
  handleTouchSensor();

  // 2. Process MAX30102 Heart Rate
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

  static unsigned long lastHrNotify = 0;
  if (bleConnected && beatAvg > 0 && (millis() - lastHrNotify > 200)) {
    lastHrNotify = millis();
    uint8_t payload = (uint8_t)beatAvg;
    hrChar->setValue(&payload, 1);
    hrChar->notify();
  }

  delay(10); // Small loop tick for responsive touch polling
}
