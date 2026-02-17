import { useSettingsContext } from "../useSettingsContext";

export function useSettingsNotificationsSectionView() {
  return useSettingsContext().sections.notifications;
}
