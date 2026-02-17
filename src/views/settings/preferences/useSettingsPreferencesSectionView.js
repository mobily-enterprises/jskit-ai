import { useSettingsContext } from "../useSettingsContext";

export function useSettingsPreferencesSectionView() {
  return useSettingsContext().sections.preferences;
}
