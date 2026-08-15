/**
 * Web mapping for Alert.alert — the pure decision logic.
 *
 * react-native-web ships `Alert` as a silent no-op: the call succeeds, no
 * dialog appears, no callback ever fires. Every confirm flow built on it —
 * sign out, delete session, clear chat — was a dead button on web. This
 * module decides what a browser should do for a given Alert.alert call; the
 * platform split lives in `lib/alert.ts`.
 *
 * Kept free of react-native imports so it runs under plain vitest/node —
 * the same reason utils/age.ts is a separate file (see vitest.config.ts).
 *
 * The mapping:
 *   - no buttons, or one button  → window.alert, then that button's onPress
 *   - two or more                → window.confirm
 *       OK      → the first non-cancel button (the action the dialog is for)
 *       Cancel  → the `style: "cancel"` button, if it has an onPress
 *
 * Three-plus button alerts lose their middle options on web — confirm() has
 * two exits. No current call site has three; if one appears, build it a real
 * dialog rather than extending this.
 */

export interface AlertWebButton {
  text?: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
}

/** The two browser primitives, injectable for tests. */
export interface WebDialogs {
  alert: (message: string) => void;
  confirm: (message: string) => boolean;
}

export function webAlert(
  dialogs: WebDialogs,
  title: string,
  message?: string,
  buttons?: AlertWebButton[],
): void {
  const text = message ? `${title}\n\n${message}` : title;

  if (!buttons || buttons.length <= 1) {
    dialogs.alert(text);
    buttons?.[0]?.onPress?.();
    return;
  }

  const cancel = buttons.find((b) => b.style === "cancel");
  const primary = buttons.find((b) => b.style !== "cancel") ?? buttons[buttons.length - 1];

  if (dialogs.confirm(text)) {
    primary.onPress?.();
  } else {
    cancel?.onPress?.();
  }
}
