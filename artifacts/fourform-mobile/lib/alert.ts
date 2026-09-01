/**
 * Cross-platform alert — a drop-in for the 16 Alert.alert call sites.
 *
 * Native keeps the platform dialog: it is what iOS and Android users expect,
 * it handles focus, dimming and accessibility for free, and the design
 * system deliberately does not re-skin OS chrome.
 *
 * Web gets window.confirm / window.alert via the mapping in alertWeb.ts,
 * because react-native-web's Alert is a silent no-op — the bug that shipped
 * a dead Sign out button. Plain browser dialogs are ugly but honest, and the
 * browser build is a development surface; the stores ship the native one.
 */

import { Alert, Platform } from "react-native";
import { webAlert, type AlertWebButton } from "./alertWeb";

export function alert(title: string, message?: string, buttons?: AlertWebButton[]): void {
  if (Platform.OS === "web") {
    webAlert({ alert: (m) => window.alert(m), confirm: (m) => window.confirm(m) }, title, message, buttons);
    return;
  }
  Alert.alert(title, message, buttons);
}
