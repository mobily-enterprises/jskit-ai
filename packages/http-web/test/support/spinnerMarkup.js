// The spinners a Vue template renders, for the source-contract tests that keep them out of shared screens.
// A `loading` prop is no spinner by itself: on a field (`SelectField`, `v-select`, `v-autocomplete`, `v-combobox`,
// `v-text-field`) or a `v-data-table`, Vuetify draws the control's own 2px progress line, the built-in loading state
// the Material 3 rules keep. A circular indicator is `v-progress-circular`, or `loading` on a button: `v-btn` and the
// components that hand `loading` to one (`v-fab`, `ShellPageAction`, `ShellPrimaryAction`).
const CIRCULAR_INDICATOR = /<(?:v-progress-circular|VProgressCircular)\b/gu;
// A button's opening tag; quoted attribute values may hold ">" (`@click="() => save()"`).
const BUTTON_TAG = /<(v-btn|VBtn|v-fab|VFab|ShellPageAction|ShellPrimaryAction)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gu;
const LOADING_ATTRIBUTE = /\s(?::|v-bind:)?loading(?=[\s=/]|$)/u;

/**
 * @param {string} source Vue template source.
 * @returns {string[]} each circular indicator it renders, as the tag that draws it.
 */
export function findSpinnerMarkup(source) {
  const found = [...source.matchAll(CIRCULAR_INDICATOR)].map((match) => match[0]);
  for (const match of source.matchAll(BUTTON_TAG)) {
    if (LOADING_ATTRIBUTE.test(match[2])) found.push(`<${match[1]} loading>`);
  }
  return found;
}
