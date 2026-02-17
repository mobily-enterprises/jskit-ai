import { useSettingsContext } from "../useSettingsContext";

export function useSettingsProfileSectionView() {
  return useSettingsContext().sections.profile;
}
