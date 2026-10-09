#include "../proximity-feedback.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>

using smart_cane::ProximityFeedback;
using smart_cane::FreshRssiNotifyGate;

namespace {

void test_moving_away_then_reapproaching_recovers_feedback() {
  ProximityFeedback feedback;
  feedback.start(0);

  feedback.observeSignal(0, -58);
  for (uint32_t now = 100; now <= 700; now += 100) {
    feedback.tick(now);
  }
  const uint8_t nearOutput = feedback.output();
  assert(nearOutput > 0);

  feedback.observeSignal(800, -82);
  const uint8_t firstFarOutput = feedback.tick(900);
  assert(firstFarOutput > 0);
  assert(firstFarOutput < nearOutput);

  uint8_t previous = firstFarOutput;
  for (uint32_t now = 900; now <= 1800; now += 100) {
    const uint8_t current = feedback.tick(now);
    assert(current <= previous);
    previous = current;
  }
  const uint8_t leavingOutput = feedback.output();
  assert(leavingOutput > 0);

  feedback.observeSignal(1900, -66);
  for (uint32_t now = 2000; now <= 2800; now += 100) {
    feedback.tick(now);
  }
  assert(feedback.output() > leavingOutput);
  assert(feedback.output() > 0);
}

void test_one_missing_scan_is_graceful_but_extended_loss_fades_to_zero() {
  ProximityFeedback feedback;
  feedback.start(0);
  feedback.observeSignal(0, -58);
  for (uint32_t now = 100; now <= 700; now += 100) {
    feedback.tick(now);
  }
  const uint8_t beforeMissingScan = feedback.output();

  const uint8_t duringGrace = feedback.tick(1100);
  assert(duringGrace > 0);
  assert(duringGrace >= beforeMissingScan);

  const uint8_t afterGrace = feedback.tick(1400);
  assert(afterGrace > 0);
  assert(afterGrace < duringGrace);

  uint8_t last = afterGrace;
  for (uint32_t now = 1500; now <= 4000; now += 100) {
    const uint8_t current = feedback.tick(now);
    assert(current <= last);
    last = current;
  }
  assert(feedback.output() == 0);
}

void test_stop_and_start_clear_previous_filter_state() {
  ProximityFeedback feedback;
  feedback.start(0);
  feedback.observeSignal(0, -58);
  feedback.tick(700);
  assert(feedback.output() > 0);

  feedback.stop(800);
  assert(feedback.output() == 0);
  assert(!feedback.active());

  feedback.start(900);
  assert(feedback.output() == 0);
  feedback.observeSignal(1000, -82);
  assert(feedback.output() < 100);

  feedback.resetTarget(1100);
  assert(feedback.output() == 0);
  assert(feedback.active());
}

void test_elapsed_time_handles_uint32_wrap() {
  ProximityFeedback feedback;
  const uint32_t beforeWrap = UINT32_MAX - 50u;
  feedback.start(beforeWrap);
  feedback.observeSignal(beforeWrap, -58);

  const uint8_t before = feedback.tick(static_cast<uint32_t>(beforeWrap + 50u));
  const uint8_t after = feedback.tick(static_cast<uint32_t>(beforeWrap + 150u));
  assert(after > before);
  assert(after > 0);
}

void test_time_reversal_does_not_create_a_large_elapsed_interval() {
  ProximityFeedback feedback;
  feedback.start(1000);
  feedback.observeSignal(1000, -58);
  const uint8_t beforeReversal = feedback.tick(1100);

  const uint8_t atReversal = feedback.tick(1000);
  assert(atReversal == beforeReversal);

  const uint8_t afterReversal = feedback.tick(1200);
  assert(afterReversal >= atReversal);
}

uint8_t run_ramp_with_tick_interval(uint32_t intervalMs, uint32_t totalMs) {
  ProximityFeedback feedback;
  feedback.start(0);
  feedback.observeSignal(0, -58);
  for (uint32_t now = intervalMs; now <= totalMs; now += intervalMs) {
    feedback.tick(now);
  }
  return feedback.output();
}

void test_ramp_progress_is_based_on_elapsed_time_not_loop_frequency() {
  const uint8_t oneMs = run_ramp_with_tick_interval(1, 300);
  const uint8_t fiveMs = run_ramp_with_tick_interval(5, 300);
  const uint8_t twentyMs = run_ramp_with_tick_interval(20, 300);
  const uint8_t hundredMs = run_ramp_with_tick_interval(100, 300);

  const uint8_t lowest = oneMs < fiveMs ? oneMs : fiveMs;
  const uint8_t lowestOfThree = lowest < twentyMs ? lowest : twentyMs;
  const uint8_t minimum = lowestOfThree < hundredMs ? lowestOfThree : hundredMs;
  const uint8_t highest = oneMs > fiveMs ? oneMs : fiveMs;
  const uint8_t highestOfThree = highest > twentyMs ? highest : twentyMs;
  const uint8_t maximum = highestOfThree > hundredMs ? highestOfThree : hundredMs;
  assert(maximum - minimum <= 1);
}

void test_new_signal_after_long_gap_does_not_jump_to_full_output() {
  ProximityFeedback feedback;
  feedback.start(0);
  feedback.observeSignal(0, -58);
  feedback.tick(100);
  const uint8_t beforeGap = feedback.output();

  feedback.observeSignal(10000, -66);
  assert(feedback.output() == beforeGap);
  const uint8_t afterOneTick = feedback.tick(10020);
  assert(afterOneTick > beforeGap);
  assert(afterOneTick < 200);
}

void test_notify_gate_emits_fresh_rssi_at_a_bounded_cadence() {
  FreshRssiNotifyGate gate;
  assert(gate.shouldNotify(0, true, false));
  assert(!gate.shouldNotify(500, false, false));
  assert(!gate.shouldNotify(999, true, false));
  assert(gate.shouldNotify(1000, true, false));
  assert(!gate.shouldNotify(1100, false, true));
  assert(gate.shouldNotify(1100, true, true));

  gate.reset();
  assert(gate.shouldNotify(2000, true, false));
}

void test_target_change_during_scan_rejects_old_result_and_keeps_scan_owned() {
  smart_cane::ScanMailbox mailbox;
  mailbox.requestStart();
  auto update = mailbox.consume();
  assert(update.reset && update.enabled);
  assert(mailbox.begin(update.generation));
  const auto oldContext = mailbox.context();
  mailbox.requestTarget("BUS_NEW");
  update = mailbox.consume();
  assert(update.reset && !update.completed);
  assert(!mailbox.begin(update.generation)); // Old callback still owns BLE results.
  mailbox.finish(oldContext.generation, true, -55);
  assert(!mailbox.consume().completed);
  assert(mailbox.begin(update.generation));
  assert(strcmp(mailbox.context().target, "BUS_NEW") == 0);
  mailbox.finish(mailbox.context().generation, true, -82);
  update = mailbox.consume();
  assert(update.completed && update.found && update.rssi == -82);
}

void test_stop_after_publication_drops_queued_rssi_and_restart_is_clean() {
  smart_cane::ScanMailbox mailbox;
  mailbox.requestStart();
  auto update = mailbox.consume();
  assert(mailbox.begin(update.generation));
  mailbox.finish(mailbox.context().generation, true, -55);
  mailbox.requestStop();
  update = mailbox.consume();
  assert(update.reset && !update.enabled && !update.completed);
  assert(!mailbox.begin(update.generation));
  mailbox.requestStart();
  update = mailbox.consume();
  assert(update.reset && update.enabled && !update.completed);
  assert(mailbox.begin(update.generation));
}

void test_rapid_stop_start_and_pending_result_cannot_be_overwritten() {
  smart_cane::ScanMailbox mailbox;
  mailbox.requestStart();
  auto update = mailbox.consume();
  assert(mailbox.begin(update.generation));
  const auto old = mailbox.context();
  mailbox.requestStop();
  mailbox.requestStart();
  mailbox.finish(old.generation, true, -55);
  update = mailbox.consume();
  assert(update.reset && update.enabled && !update.completed);
  assert(mailbox.begin(update.generation));
  mailbox.finish(mailbox.context().generation, false, -100);
  assert(!mailbox.begin(update.generation)); // Consume completion before next scan.
  update = mailbox.consume();
  assert(update.completed && !update.found);
  assert(mailbox.begin(update.generation));
  mailbox.startFailed(mailbox.context().generation);
  assert(mailbox.begin(update.generation));
}

void test_command_between_consume_and_scan_start_requires_fresh_control() {
  smart_cane::ScanMailbox mailbox;
  mailbox.requestStart();
  auto update = mailbox.consume();
  mailbox.requestTarget("BUS_NEW");
  assert(!mailbox.begin(update.generation));
  update = mailbox.consume();
  assert(mailbox.begin(update.generation));
}

void test_weak_signal_recovers_after_full_loss() {
  ProximityFeedback feedback;
  feedback.start(0);
  feedback.observeSignal(0, -58);
  for (uint32_t now = 20; now <= 4000; now += 20) feedback.tick(now);
  assert(feedback.output() == 0);
  feedback.observeSignal(4020, -82);
  for (uint32_t now = 4040; now <= 4620; now += 20) feedback.tick(now);
  assert(feedback.output() > 0 && feedback.output() < 100);
}

// Deterministic scheduler: a competing task can acquire this mutex exactly
// when held is false. tryRun models the other task's attempt without sleeps.
struct TestTaskMutex {
  bool held = false;
  bool tryLock() {
    if (held) return false;
    held = true;
    return true;
  }
  void lock() { assert(tryLock()); }
  void unlock() { assert(held); held = false; }
};

void test_commands_cannot_be_accepted_between_consumption_and_output() {
  for (int command = 0; command < 2; ++command) {
    TestTaskMutex mutex;
    smart_cane::FeedbackTransactions<TestTaskMutex> transactions(mutex);
    smart_cane::ScanMailbox mailbox;
    mailbox.requestStart();
    auto update = mailbox.consume();
    assert(mailbox.begin(update.generation));
    mailbox.finish(mailbox.context().generation, true, -55);
    bool commandAccepted = false;
    int notifications = 0;
    int pwmWrites = 0;
    assert(transactions.tryRun([&]() {
      update = mailbox.consume();
      assert(update.completed && update.found);
      // Force the reviewer's exact interleaving after consume, before
      // observeSignal/Notify/PWM. Acceptance must wait for this transaction.
      assert(!transactions.tryRun([&]() {
        commandAccepted = true;
        if (command == 0) mailbox.requestStop();
        else mailbox.requestTarget("BUS_NEW");
      }));
      assert(!commandAccepted);
      ++notifications;
      ++pwmWrites;
    }));
    transactions.run([&]() {
      commandAccepted = true;
      if (command == 0) mailbox.requestStop();
      else mailbox.requestTarget("BUS_NEW");
    });
    assert(commandAccepted && notifications == 1 && pwmWrites == 1);
    assert(transactions.tryRun([&]() {
      update = mailbox.consume();
      assert(update.reset && !update.completed);
      assert(update.enabled == (command != 0));
    }));
    assert(notifications == 1 && pwmWrites == 1);
  }
}

void test_command_transaction_excludes_output_and_discards_pending_sample() {
  TestTaskMutex mutex;
  smart_cane::FeedbackTransactions<TestTaskMutex> transactions(mutex);
  smart_cane::ScanMailbox mailbox;
  mailbox.requestStart();
  auto update = mailbox.consume();
  assert(mailbox.begin(update.generation));
  mailbox.finish(mailbox.context().generation, true, -55);
  int notifications = 0;
  transactions.run([&]() {
    mailbox.requestStop();
    assert(!transactions.tryRun([&]() { ++notifications; }));
  });
  assert(transactions.tryRun([&]() {
    update = mailbox.consume();
    if (update.completed && update.found) ++notifications;
  }));
  assert(notifications == 0 && update.reset && !update.enabled);
}

struct SimulatedGattTransport {
  char sharedRx[128] = "{\"cmd\":\"STOP_BEACON_SCAN\"}";
  char transmitted[128] = {};
  bool writeArrivesBeforeSubmit = false;
  int sends = 0;
  uint16_t lastConnection = 0;
  void setSharedValue(const uint8_t* payload, size_t length) {
    memcpy(sharedRx, payload, length); sharedRx[length] = '\0';
  }
  bool notifySharedValue(uint16_t id) {
    if (writeArrivesBeforeSubmit) strcpy(sharedRx, "{\"cmd\":\"STOP_BEACON_SCAN\"}");
    return sendRaw(id, reinterpret_cast<const uint8_t*>(sharedRx), strlen(sharedRx));
  }
  bool sendRaw(uint16_t id, const uint8_t* payload, size_t length) {
    if (writeArrivesBeforeSubmit) strcpy(sharedRx, "{\"cmd\":\"STOP_BEACON_SCAN\"}");
    memcpy(transmitted, payload, length); transmitted[length] = '\0';
    ++sends; lastConnection = id;
    return true;
  }
};

void test_notification_does_not_overwrite_unconsumed_regular_or_prepared_command() {
  const char* commands[] = {"{\"cmd\":\"STOP_BEACON_SCAN\"}",
      "{\"cmd\":\"SET_TARGET_BEACON\",\"target\":\"BUS_1551_001\"}"};
  for (const char* command : commands) {
    SimulatedGattTransport transport;
    strcpy(transport.sharedRx, command); // SDK Write/EXEC_WRITE before onWrite.
    smart_cane::NotificationPeer peer;
    peer.connected = true; peer.subscribed = true; peer.mtu = 100;
    const char* json = "{\"state\":\"ARRIVED\",\"rssi\":-60}";
    assert(smart_cane::sendIndependentNotification(transport, peer,
        reinterpret_cast<const uint8_t*>(json), strlen(json)));
    assert(strcmp(transport.sharedRx, command) == 0); // onWrite can still copy RX.
    assert(strcmp(transport.transmitted, json) == 0);
  }
}

void test_sdk_write_cannot_replace_json_between_notify_build_and_submit() {
  SimulatedGattTransport transport;
  transport.writeArrivesBeforeSubmit = true;
  smart_cane::NotificationPeer peer;
  peer.connected = true; peer.subscribed = true; peer.mtu = 100;
  const char* json = "{\"state\":\"ARRIVED\",\"rssi\":-60}";
  assert(smart_cane::sendIndependentNotification(transport, peer,
      reinterpret_cast<const uint8_t*>(json), strlen(json)));
  assert(strcmp(transport.transmitted, json) == 0);
  assert(strcmp(transport.sharedRx, "{\"cmd\":\"STOP_BEACON_SCAN\"}") == 0);
}

void test_notification_requires_per_connection_subscription_and_complete_mtu() {
  smart_cane::NotificationPeers<2> peers;
  SimulatedGattTransport transport;
  const char* json = "{\"state\":\"ARRIVED\",\"rssi\":-60}";
  const auto send = [&](size_t slot) {
    return smart_cane::sendIndependentNotification(transport, peers.at(slot),
        reinterpret_cast<const uint8_t*>(json), strlen(json));
  };
  assert(!send(0));
  peers.connect(7);
  peers.setMtu(7, 100);
  assert(!send(0));
  peers.subscribe(7, true);
  assert(send(0) && transport.lastConnection == 7);
  peers.connect(8);
  assert(!send(1)); // Another connection does not inherit the first's CCCD.
  peers.subscribe(7, false);
  assert(!send(0));
  peers.disconnect(7);
  assert(!send(0));
  peers.connect(7); // Reused connId loses old MTU and subscription.
  assert(!send(0));
  peers.subscribe(7, true);
  assert(!send(0)); // Default MTU23 cannot carry the full JSON; never truncate.
  peers.setMtu(7, static_cast<uint16_t>(strlen(json) + 2));
  assert(!send(0));
  peers.setMtu(7, static_cast<uint16_t>(strlen(json) + 3));
  assert(send(0));
  assert(transport.sends == 2);
}

void test_all_notify_states_fit_one_mtu64_frame() {
  const char* states[] = {"APPROACHING", "ARRIVED", "PASSING", "PASSED_STOPPED", "LEAVING"};
  const int readings[] = {-100, -55, INT32_MIN};
  for (const char* state : states) {
    for (int rssi : readings) {
      smart_cane::NotificationFrame frame(state, rssi);
      assert(frame.length > 0 && frame.length <= 61);
      assert(frame.length == strlen(frame.bytes));
      assert(frame.bytes[frame.length - 1] == '}');
    }
  }
  smart_cane::NotificationFrame oversized("STATE_STRING_THAT_IS_INTENTIONALLY_LONGER_THAN_THE_ENTIRE_PAYLOAD_BUDGET", -100);
  assert(oversized.length == 0);
}

}  // namespace

int main() {
  test_moving_away_then_reapproaching_recovers_feedback();
  test_one_missing_scan_is_graceful_but_extended_loss_fades_to_zero();
  test_stop_and_start_clear_previous_filter_state();
  test_elapsed_time_handles_uint32_wrap();
  test_time_reversal_does_not_create_a_large_elapsed_interval();
  test_ramp_progress_is_based_on_elapsed_time_not_loop_frequency();
  test_new_signal_after_long_gap_does_not_jump_to_full_output();
  test_notify_gate_emits_fresh_rssi_at_a_bounded_cadence();
  test_target_change_during_scan_rejects_old_result_and_keeps_scan_owned();
  test_stop_after_publication_drops_queued_rssi_and_restart_is_clean();
  test_rapid_stop_start_and_pending_result_cannot_be_overwritten();
  test_command_between_consume_and_scan_start_requires_fresh_control();
  test_weak_signal_recovers_after_full_loss();
  test_commands_cannot_be_accepted_between_consumption_and_output();
  test_command_transaction_excludes_output_and_discards_pending_sample();
  test_notification_does_not_overwrite_unconsumed_regular_or_prepared_command();
  test_sdk_write_cannot_replace_json_between_notify_build_and_submit();
  test_notification_requires_per_connection_subscription_and_complete_mtu();
  test_all_notify_states_fit_one_mtu64_frame();
  printf("proximity-feedback tests: 19 PASS\n");
  return 0;
}
