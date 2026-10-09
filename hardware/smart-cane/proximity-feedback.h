#ifndef SMART_CANE_PROXIMITY_FEEDBACK_H
#define SMART_CANE_PROXIMITY_FEEDBACK_H

#include <stdint.h>
#include <string.h>
#include <stdio.h>

namespace smart_cane {

struct NotificationFrame {
  char bytes[64];
  size_t length;
  NotificationFrame(const char* state, int rssi) : length(0) {
    const int count = snprintf(bytes, sizeof(bytes), "{\"state\":\"%s\",\"rssi\":%d}", state, rssi);
    // MTU64 minimum agreed with the app leaves 61 bytes for one complete JSON.
    if (count > 0 && count <= 61 && static_cast<size_t>(count) < sizeof(bytes)) length = count;
  }
};

struct NotificationPeer {
  bool connected = false;
  bool subscribed = false;
  uint16_t connectionId = 0;
  uint16_t mtu = 23;

  bool canSend(size_t length) const {
    return connected && subscribed && length > 0 && mtu >= 23 && length <= mtu - 3u;
  }
};

template <size_t Capacity>
class NotificationPeers {
 public:
  void connect(uint16_t id) {
    NotificationPeer* peer = find(id);
    if (!peer) {
      for (size_t i = 0; i < Capacity; ++i) {
        if (!peers_[i].connected) { peer = &peers_[i]; break; }
      }
    }
    if (!peer) return;
    *peer = NotificationPeer();
    peer->connectionId = id;
    peer->connected = true;
  }
  void disconnect(uint16_t id) {
    NotificationPeer* peer = find(id);
    if (peer) *peer = NotificationPeer();
  }
  void setMtu(uint16_t id, uint16_t mtu) {
    NotificationPeer* peer = find(id);
    if (peer && mtu >= 23) peer->mtu = mtu;
  }
  void subscribe(uint16_t id, bool enabled) {
    NotificationPeer* peer = find(id);
    if (peer) peer->subscribed = enabled;
  }
  const NotificationPeer& at(size_t index) const { return peers_[index]; }

 private:
  NotificationPeer* find(uint16_t id) {
    for (size_t i = 0; i < Capacity; ++i) {
      if (peers_[i].connected && peers_[i].connectionId == id) return &peers_[i];
    }
    return 0;
  }
  NotificationPeer peers_[Capacity];
};

// The transport receives caller-owned immutable bytes; it must copy/submit
// them before returning, without writing the characteristic's RX storage.
template <typename Transport>
bool sendIndependentNotification(Transport& transport, const NotificationPeer& peer,
                                 const uint8_t* payload, size_t length) {
  if (!peer.canSend(length)) return false;
  return transport.sendRaw(peer.connectionId, payload, length);
}

// One transaction boundary shared by command acceptance and output effects.
// The firmware adapter uses a task mutex, never an interrupt-disabling lock.
template <typename Mutex>
class FeedbackTransactions {
 public:
  explicit FeedbackTransactions(Mutex& mutex) : mutex_(mutex) {}

  template <typename Action>
  bool tryRun(Action action) {
    if (!mutex_.tryLock()) return false;
    UnlockOnExit release(mutex_);
    action();
    return true;
  }

  template <typename Action>
  void run(Action action) {
    mutex_.lock();
    UnlockOnExit release(mutex_);
    action();
  }

 private:
  class UnlockOnExit {
   public:
    explicit UnlockOnExit(Mutex& mutex) : mutex_(mutex) {}
    ~UnlockOnExit() { mutex_.unlock(); }
   private:
    Mutex& mutex_;
  };
  Mutex& mutex_;
};

// Caller holds the firmware's short critical section around each operation.
// Coalescing commands keeps the latest desired state without a full queue;
// every command still invalidates old samples and forces a clean filter.
struct ScanContext {
  uint32_t generation;
  char target[64];
};

struct FeedbackUpdate {
  uint32_t generation;
  bool reset;
  bool enabled;
  bool completed;
  bool found;
  int rssi;
};

class ScanMailbox {
 public:
  ScanMailbox()
      : generation_(0), enabled_(false), dirty_(false), inFlight_(false),
        completed_(false), found_(false), rssi_(-100) {
    copyTarget(target_, "BUS_1551_001");
    context_.generation = 0;
    copyTarget(context_.target, target_);
  }

  void requestStart() { enabled_ = true; invalidate(); }
  void requestStop() { enabled_ = false; invalidate(); }
  void requestTarget(const char* target) { copyTarget(target_, target); invalidate(); }

  FeedbackUpdate consume() {
    FeedbackUpdate update = {generation_, dirty_, enabled_, completed_, found_, rssi_};
    dirty_ = false;
    completed_ = false;
    return update;
  }

  bool begin(uint32_t appliedGeneration) {
    if (!enabled_ || dirty_ || inFlight_ || completed_ ||
        appliedGeneration != generation_) return false;
    context_.generation = generation_;
    copyTarget(context_.target, target_);
    inFlight_ = true;
    return true;
  }

  ScanContext context() const { return context_; }

  // Called only after result parsing AND BLE clearResults() finish. A new
  // scan cannot start while the previous callback still uses its results.
  void finish(uint32_t capturedGeneration, bool found, int rssi) {
    if (!inFlight_ || context_.generation != capturedGeneration) return;
    if (enabled_ && generation_ == capturedGeneration) {
      completed_ = true;
      found_ = found;
      rssi_ = rssi;
    }
    inFlight_ = false;
  }

  void startFailed(uint32_t capturedGeneration) {
    if (inFlight_ && context_.generation == capturedGeneration) inFlight_ = false;
  }

 private:
  static void copyTarget(char* destination, const char* source) {
    strncpy(destination, source, 63);
    destination[63] = '\0';
  }
  void invalidate() {
    ++generation_;
    dirty_ = true;
    completed_ = false;
  }

  uint32_t generation_;
  bool enabled_;
  bool dirty_;
  bool inFlight_;
  bool completed_;
  bool found_;
  int rssi_;
  char target_[64];
  ScanContext context_;
};

// The controller is deliberately independent of Arduino and BLE types. The
// firmware feeds it a monotonic millisecond clock and the latest RSSI sample,
// while the host replay uses the same calls with deterministic timestamps.
struct FeedbackConfig {
  int farRssi;
  int nearRssi;
  uint32_t signalGraceMs;
  uint32_t rampUpMs;
  uint32_t fadeOutMs;
  uint8_t maxPwm;

  FeedbackConfig()
      : farRssi(-90),
        nearRssi(-55),
        signalGraceMs(1200),
        rampUpMs(600),
        fadeOutMs(1200),
        maxPwm(255) {}
};

// Notify cadence is kept separate from scan state so it can be replayed on a
// host. A notification is admitted only for a fresh advertisement; callers
// must pass false when the scan window had no target result.
class FreshRssiNotifyGate {
 public:
  explicit FreshRssiNotifyGate(uint32_t intervalMs = 1000)
      : intervalMs_(intervalMs), hasNotified_(false), lastNotifyAt_(0) {}

  void reset() {
    hasNotified_ = false;
    lastNotifyAt_ = 0;
  }

  bool shouldNotify(uint32_t nowMs, bool hasFreshRssi, bool stateChanged) {
    if (!hasFreshRssi) return false;
    if (!hasNotified_ || stateChanged || elapsed(nowMs, lastNotifyAt_) >= intervalMs_) {
      hasNotified_ = true;
      lastNotifyAt_ = nowMs;
      return true;
    }
    return false;
  }

 private:
  static uint32_t elapsed(uint32_t nowMs, uint32_t previousMs) {
    const int32_t signedDelta = static_cast<int32_t>(nowMs - previousMs);
    return signedDelta > 0 ? static_cast<uint32_t>(signedDelta) : 0;
  }

  uint32_t intervalMs_;
  bool hasNotified_;
  uint32_t lastNotifyAt_;
};

class ProximityFeedback {
 public:
  explicit ProximityFeedback(const FeedbackConfig& config = FeedbackConfig())
      : config_(config),
        active_(false),
        hasSignal_(false),
        clockInitialized_(false),
        lastSignalAt_(0),
        lastNow_(0),
        targetPwm_(0),
        outputPwm_(0),
        rampRemainder_(0),
        rampDirectionInitialized_(false),
        rampRising_(false) {}

  // A new START always begins with a clean filter and a quiet motor.
  void start(uint32_t nowMs) {
    active_ = true;
    resetFilter(nowMs);
  }

  // STOP is intentionally immediate; the next START must not inherit it.
  void stop(uint32_t nowMs) {
    active_ = false;
    resetFilter(nowMs);
  }

  // A changed target has the same filter boundary as START, but keeps a
  // currently active scan enabled.
  void resetTarget(uint32_t nowMs) {
    const bool wasActive = active_;
    resetFilter(nowMs);
    active_ = wasActive;
  }

  // Record one newly observed target beacon advertisement. The output itself
  // is advanced by loop-time tick() calls so a delayed scan callback cannot
  // turn a long scheduling gap into an abrupt motor jump.
  uint8_t observeSignal(uint32_t nowMs, int rssi) {
    advanceClock(nowMs);
    if (!active_) return 0;

    hasSignal_ = true;
    lastSignalAt_ = nowMs;
    targetPwm_ = pwmForRssi(rssi);
    return outputPwm_;
  }

  // Advance the output without inventing a new RSSI sample. This is called
  // from loop() at a short interval, including during an asynchronous scan.
  uint8_t tick(uint32_t nowMs) {
    const uint32_t elapsedMs = advanceClock(nowMs);
    if (!active_) return 0;

    if (!hasSignal_ || elapsedSinceSignal(nowMs) > config_.signalGraceMs) {
      targetPwm_ = 0;
    }
    return ramp(elapsedMs);
  }

  bool active() const { return active_; }
  bool hasSignal() const { return hasSignal_; }
  uint8_t output() const { return outputPwm_; }
  uint8_t target() const { return targetPwm_; }

 private:
  static int clampInt(int value, int low, int high) {
    if (value < low) return low;
    if (value > high) return high;
    return value;
  }

  uint8_t pwmForRssi(int rssi) const {
    if (config_.nearRssi <= config_.farRssi) return config_.maxPwm;
    const int clamped = clampInt(rssi, config_.farRssi, config_.nearRssi);
    const int distance = clamped - config_.farRssi;
    const int span = config_.nearRssi - config_.farRssi;
    const int scaled = (distance * static_cast<int>(config_.maxPwm)) / span;
    return static_cast<uint8_t>(clampInt(scaled, 0, config_.maxPwm));
  }

  void resetFilter(uint32_t nowMs) {
    hasSignal_ = false;
    clockInitialized_ = true;
    lastSignalAt_ = nowMs;
    lastNow_ = nowMs;
    targetPwm_ = 0;
    outputPwm_ = 0;
    rampRemainder_ = 0;
    rampDirectionInitialized_ = false;
  }

  // Signed subtraction handles the normal uint32_t millis() wrap. A
  // genuinely backwards timestamp is treated as a zero-length interval so a
  // stale clock cannot trigger a full fade or an immediate reset.
  uint32_t advanceClock(uint32_t nowMs) {
    if (!clockInitialized_) {
      clockInitialized_ = true;
      lastNow_ = nowMs;
      return 0;
    }
    const int32_t signedDelta = static_cast<int32_t>(nowMs - lastNow_);
    lastNow_ = nowMs;
    return signedDelta > 0 ? static_cast<uint32_t>(signedDelta) : 0;
  }

  uint32_t elapsedSinceSignal(uint32_t nowMs) const {
    if (!hasSignal_) return 0;
    const int32_t signedDelta = static_cast<int32_t>(nowMs - lastSignalAt_);
    return signedDelta > 0 ? static_cast<uint32_t>(signedDelta) : 0;
  }

  uint8_t ramp(uint32_t elapsedMs) {
    if (elapsedMs == 0 || outputPwm_ == targetPwm_) return outputPwm_;

    const bool rising = targetPwm_ > outputPwm_;
    const uint32_t durationMs = rising ? config_.rampUpMs : config_.fadeOutMs;
    const uint8_t distance = rising
        ? static_cast<uint8_t>(targetPwm_ - outputPwm_)
        : static_cast<uint8_t>(outputPwm_ - targetPwm_);
    if (durationMs == 0) {
      outputPwm_ = targetPwm_;
      rampRemainder_ = 0;
      return outputPwm_;
    }

    if (!rampDirectionInitialized_ || rampRising_ != rising) {
      rampRemainder_ = 0;
      rampRising_ = rising;
      rampDirectionInitialized_ = true;
    }

    // A fixed full-scale rate reaches a near target in rampUpMs and fades a
    // full-scale output in fadeOutMs. Keep the fractional millisecond budget
    // so 1 ms and 100 ms loop schedules produce the same elapsed-time result.
    const uint64_t budget = static_cast<uint64_t>(config_.maxPwm) * elapsedMs
        + rampRemainder_;
    uint32_t change = static_cast<uint32_t>(budget / durationMs);
    rampRemainder_ = static_cast<uint32_t>(budget % durationMs);
    if (change >= distance) {
      outputPwm_ = targetPwm_;
      rampRemainder_ = 0;
    } else if (rising) {
      outputPwm_ = static_cast<uint8_t>(outputPwm_ + change);
    } else {
      outputPwm_ = static_cast<uint8_t>(outputPwm_ - change);
    }
    return outputPwm_;
  }

  FeedbackConfig config_;
  bool active_;
  bool hasSignal_;
  bool clockInitialized_;
  uint32_t lastSignalAt_;
  uint32_t lastNow_;
  uint8_t targetPwm_;
  uint8_t outputPwm_;
  uint32_t rampRemainder_;
  bool rampDirectionInitialized_;
  bool rampRising_;
};

}  // namespace smart_cane

#endif  // SMART_CANE_PROXIMITY_FEEDBACK_H
