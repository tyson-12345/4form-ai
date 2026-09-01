import { describe, expect, it, vi } from "vitest";
import { webAlert, type WebDialogs } from "./alertWeb";

function dialogs(confirmAnswer = true) {
  return {
    alert: vi.fn<(m: string) => void>(),
    confirm: vi.fn<(m: string) => boolean>(() => confirmAnswer),
  } satisfies WebDialogs;
}

describe("webAlert", () => {
  it("shows title and message joined for informational alerts", () => {
    const d = dialogs();
    webAlert(d, "Couldn't save", "Please try again.");
    expect(d.alert).toHaveBeenCalledWith("Couldn't save\n\nPlease try again.");
    expect(d.confirm).not.toHaveBeenCalled();
  });

  it("shows the title alone when there is no message", () => {
    const d = dialogs();
    webAlert(d, "Done");
    expect(d.alert).toHaveBeenCalledWith("Done");
  });

  it("fires the single button's onPress after an informational alert", () => {
    const d = dialogs();
    const onPress = vi.fn();
    webAlert(d, "Heads up", undefined, [{ text: "OK", onPress }]);
    expect(d.alert).toHaveBeenCalled();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // The dialog that shipped broken: Sign out. Confirm must run the
  // destructive action, cancel must not.
  it("runs the non-cancel action when the user confirms", () => {
    const d = dialogs(true);
    const signOut = vi.fn();
    const cancel = vi.fn();
    webAlert(d, "Sign out", "You can sign back in any time.", [
      { text: "Cancel", style: "cancel", onPress: cancel },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("runs the cancel handler when the user declines", () => {
    const d = dialogs(false);
    const signOut = vi.fn();
    const cancel = vi.fn();
    webAlert(d, "Sign out", "You can sign back in any time.", [
      { text: "Cancel", style: "cancel", onPress: cancel },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);
    expect(signOut).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does nothing on decline when the cancel button has no handler", () => {
    const d = dialogs(false);
    const action = vi.fn();
    webAlert(d, "Delete this session and its clip?", undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: action },
    ]);
    expect(action).not.toHaveBeenCalled();
  });

  it("treats button order as irrelevant — the cancel style is what matters", () => {
    const d = dialogs(true);
    const action = vi.fn();
    webAlert(d, "Clear conversation", undefined, [
      { text: "Clear", style: "destructive", onPress: action },
      { text: "Cancel", style: "cancel" },
    ]);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
