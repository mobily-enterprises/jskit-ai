import { useSettingsContext } from "../useSettingsContext";

export function useSettingsSecuritySectionView() {
  return useSettingsContext().sections.security;
}
